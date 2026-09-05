const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { sendTextMessage } = require('../whatsapp');
const bot = require('../services/bot');
const media = require('../services/media');

const router = express.Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/', (req, res) => {
  if (!verifySignature(req)) {
    return res.sendStatus(401);
  }
  res.sendStatus(200);

  const entries = req.body?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      handleChange(change.value).catch((err) =>
        console.error('Webhook processing error:', err.message)
      );
    }
  }
});

function verifySignature(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true;
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !req.rawBody) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}


const STATUS_MAP = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

async function handleChange(value) {
  for (const status of value.statuses ?? []) {
    const mapped = STATUS_MAP[status.status];
    if (!mapped) continue;
    await pool.query(
      `UPDATE messages
          SET delivery_status = $2,
              sent_at = COALESCE(sent_at, to_timestamp($3::bigint))
        WHERE external_message_id = $1
          AND CASE delivery_status
                WHEN 'QUEUED' THEN 1 WHEN 'SENT' THEN 2
                WHEN 'DELIVERED' THEN 3 WHEN 'READ' THEN 4 ELSE 0
              END <=
              CASE $2
                WHEN 'SENT' THEN 2 WHEN 'DELIVERED' THEN 3
                WHEN 'READ' THEN 4 WHEN 'FAILED' THEN 2 ELSE 1
              END`,
      [status.id, mapped, status.timestamp]
    );
  }

  for (const message of value.messages ?? []) {
    await handleInboundMessage(message).catch((err) =>
      console.error(`Inbound message ${message.id} failed:`, err.message)
    );
  }
}

async function handleInboundMessage(message) {
  const waId = message.from;

  const driverResult = await pool.query(
    `SELECT d.id AS driver_id, d.organization_id, d.active_job_id, d.name, d.vehicle_type
       FROM driver_whatsapp_accounts wa
       JOIN drivers d ON d.id = wa.driver_id
      WHERE regexp_replace(wa.phone_e164, '\\D', '', 'g') = $1
        AND wa.verification_status <> 'REVOKED'
        AND d.status = 'ACTIVE'
      ORDER BY wa.is_primary DESC
      LIMIT 1`,
    [waId]
  );

  if (driverResult.rows.length === 0) {
    await sendTextMessage(
      waId,
      'This number is not registered with our fleet. Please contact your fleet manager to register as a driver.'
    ).catch((err) => console.error('Registration reply failed:', err.message));
    console.log(`Inbound message from unregistered number ${waId} — registration reply sent.`);
    return;
  }
  const driver = driverResult.rows[0];

  const convoResult = await pool.query(
    `SELECT id, job_id, ai_paused_at FROM conversations
      WHERE driver_id = $1 AND status = 'OPEN'
      ORDER BY created_at
      LIMIT 1`,
    [driver.driver_id]
  );
  let conversationId;
  let aiPaused = false;
  if (convoResult.rows.length > 0) {
    conversationId = convoResult.rows[0].id;
    aiPaused = convoResult.rows[0].ai_paused_at != null;
    if (driver.active_job_id && convoResult.rows[0].job_id !== driver.active_job_id) {
      await pool.query(`UPDATE conversations SET job_id = $2 WHERE id = $1`, [conversationId, driver.active_job_id]);
    }
  } else {
    const created = await pool.query(
      `INSERT INTO conversations (organization_id, driver_id, job_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [driver.organization_id, driver.driver_id, driver.active_job_id]
    );
    conversationId = created.rows[0].id;
  }

  const { messageType, bodyText, buttonId } = extractContent(message);
  const replyToMessageId = message.context?.id ?? null;
  const inserted = await pool.query(
    `INSERT INTO messages (
        conversation_id, external_message_id, sender_type, sender_driver_id,
        message_type, source_type, body_text, delivery_status, received_at
     ) VALUES ($1, $2, 'DRIVER', $3, $4, 'DRIVER_MESSAGE', $5, 'RECEIVED',
               to_timestamp($6::bigint))
     ON CONFLICT (external_message_id) DO NOTHING
     RETURNING id`,
    [conversationId, message.id, driver.driver_id, messageType, bodyText, message.timestamp]
  );

  if (inserted.rows.length === 0) {
    return;
  }
  const storedMessageId = inserted.rows[0].id;

  const mediaPayload = message[message.type];
  if (mediaPayload && mediaPayload.id && ['audio', 'image', 'document', 'video'].includes(message.type)) {
    await pool.query(
      `INSERT INTO attachments (message_id, attachment_type, storage_key, original_filename, mime_type, transcription_text)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        storedMessageId,
        message.type.toUpperCase(),
        mediaPayload.id,
        mediaPayload.filename ?? null,
        mediaPayload.mime_type ?? 'application/octet-stream',
        mediaPayload.transcript ?? null,
      ]
    );

    if (['image', 'document', 'video'].includes(message.type)) {
      media.storeInboundMedia(storedMessageId, driver.active_job_id ?? driver.driver_id)
        .catch((err) => console.error(`R2 mirror failed for message ${storedMessageId}:`, err.message));
    }
  }

  if (!aiPaused && messageType === 'VIDEO') {
    await sendTextMessage(
      waId,
      'Sorry, I cannot process videos. Please send a clear photo instead so I can help you.'
    ).catch((err) => console.error('Video rejection reply failed:', err.message));
  }

  if (!aiPaused && ['TEXT', 'BUTTON', 'AUDIO', 'IMAGE', 'DOCUMENT', 'LOCATION'].includes(messageType)) {
    bot.processInbound({
      driver: { ...driver, waId },
      conversationId,
      messageId: storedMessageId,
      messageType,
      bodyText,
      buttonId,
      replyToMessageId,
    }).catch((err) => console.error(`Bot failed for message ${storedMessageId}:`, err.message));
  }

  await pool.query(
    `UPDATE conversations SET last_message_at = now() WHERE id = $1`,
    [conversationId]
  );
  await pool.query(
    `UPDATE driver_whatsapp_accounts SET last_message_at = now()
      WHERE driver_id = $1 AND regexp_replace(phone_e164, '\\D', '', 'g') = $2`,
    [driver.driver_id, waId]
  );
}

function extractContent(message) {
  switch (message.type) {
    case 'text':
      return { messageType: 'TEXT', bodyText: message.text?.body ?? '' };
    case 'audio':
      return { messageType: 'AUDIO', bodyText: '[Voice message]' };
    case 'image':
      return { messageType: 'IMAGE', bodyText: message.image?.caption || '[Image]' };
    case 'document':
      return { messageType: 'DOCUMENT', bodyText: message.document?.caption || '[Document]' };
    case 'video':
      return { messageType: 'VIDEO', bodyText: message.video?.caption || '[Video]' };
    case 'location':
      return {
        messageType: 'LOCATION',
        bodyText: `${message.location?.latitude},${message.location?.longitude}`,
      };
    case 'button':
      return { messageType: 'BUTTON', bodyText: message.button?.text ?? '', buttonId: message.button?.payload ?? null };
    case 'interactive': {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      return { messageType: 'BUTTON', bodyText: reply?.title ?? '[Interactive reply]', buttonId: reply?.id ?? null };
    }
    default:
      return { messageType: 'SYSTEM', bodyText: `[Unsupported message type: ${message.type}]` };
  }
}

module.exports = router;
