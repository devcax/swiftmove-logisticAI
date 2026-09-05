const express = require("express");
const { pool } = require("../db");
const { sendTextMessage } = require("../whatsapp");
const { interpretationFields } = require("../services/format");

const router = express.Router();

const KIND_MAP = {
  DRIVER: "DRIVER",
  MANAGER: "MANAGER",
  BOT: "BOT",
  SYSTEM: "BOT",
};

router.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT c.id,
            d.name                                       AS driver,
            wa.phone_e164                                AS phone,
            wa.verification_status                       AS verification_status,
            COALESCE(j.job_number, 'No active job')      AS job_number,
            (SELECT m.body_text
               FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1)                                   AS last_message,
            (SELECT COUNT(*)::int
               FROM messages m
              WHERE m.conversation_id = c.id
                AND m.sender_type = 'DRIVER'
                AND m.created_at > COALESCE(c.manager_last_read_at, c.created_at))
                                                        AS unread_count,
            c.last_message_at,
            c.ai_paused_at
       FROM conversations c
       JOIN drivers d ON d.id = c.driver_id
       LEFT JOIN driver_whatsapp_accounts wa
              ON wa.driver_id = d.id AND wa.is_primary
       LEFT JOIN jobs j ON j.id = c.job_id
      WHERE c.status = 'OPEN'
      ORDER BY c.last_message_at DESC NULLS LAST`,
  );

  res.json(
    result.rows.map((row) => ({
      id: row.id,
      driver: row.driver,
      phone: row.phone ?? "",
      jobNumber: row.job_number,
      lastMessage: row.last_message ?? "",
      lastActivity: row.last_message_at,
      unread: row.unread_count,
      verified: row.verification_status === "VERIFIED",
      aiPaused: row.ai_paused_at != null,
    })),
  );
});

router.post("/:id/read", async (req, res) => {
  const updated = await pool.query(
    `UPDATE conversations
        SET manager_last_read_at = now()
      WHERE id = $1
      RETURNING manager_last_read_at`,
    [req.params.id],
  );

  if (updated.rows.length === 0) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  res.json({ readAt: updated.rows[0].manager_last_read_at });
});

router.get("/:id", async (req, res) => {
  const result = await pool.query(
    `SELECT c.id, c.status, c.job_id, c.ai_paused_at,
            d.name AS driver, wa.phone_e164 AS phone, wa.verification_status,
            j.job_number
       FROM conversations c
       JOIN drivers d ON d.id = c.driver_id
       LEFT JOIN driver_whatsapp_accounts wa
              ON wa.driver_id = d.id AND wa.is_primary
       LEFT JOIN jobs j ON j.id = c.job_id
      WHERE c.id = $1`,
    [req.params.id],
  );
  if (result.rows.length === 0)
    return res.status(404).json({ error: "Conversation not found" });

  const row = result.rows[0];
  res.json({
    id: row.id,
    status: row.status,
    driver: row.driver,
    phone: row.phone ?? "",
    jobNumber: row.job_number ?? "No active job",
    verified: row.verification_status === "VERIFIED",
    aiPaused: row.ai_paused_at != null,
  });
});

router.post("/:id/takeover", async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const updated = await pool.query(
    `UPDATE conversations
        SET ai_paused_at = CASE WHEN $2 THEN now() ELSE NULL END
      WHERE id = $1
      RETURNING ai_paused_at`,
    [req.params.id, enabled],
  );
  if (updated.rows.length === 0) {
    return res.status(404).json({ error: "Conversation not found" });
  }
  res.json({ aiPaused: updated.rows[0].ai_paused_at != null });
});

router.get("/:id/messages", async (req, res) => {
  const result = await pool.query(
    `SELECT m.id, m.sender_type, m.message_type, m.body_text,
            m.delivery_status, m.created_at,
            ai.primary_intent, ai.confidence_score, ai.structured_output, ai.processing_status
       FROM messages m
       LEFT JOIN ai_interpretations ai ON ai.message_id = m.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT 500`,
    [req.params.id],
  );

  const attachments = await pool.query(
    `SELECT a.id, a.message_id, a.attachment_type, a.original_filename,
            a.mime_type, a.public_url, a.created_at
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
      WHERE m.conversation_id = $1
      ORDER BY a.created_at ASC`,
    [req.params.id],
  );

  const attachmentsByMessage = new Map();
  for (const attachment of attachments.rows) {
    const list = attachmentsByMessage.get(attachment.message_id) ?? [];
    list.push({
      id: attachment.id,
      type: attachment.attachment_type,
      filename: attachment.original_filename,
      mimeType: attachment.mime_type,
      publicUrl: attachment.public_url ?? null,
      createdAt: attachment.created_at,
    });
    attachmentsByMessage.set(attachment.message_id, list);
  }

  res.json(
    result.rows.map((row) => ({
      id: row.id,
      kind: KIND_MAP[row.sender_type] ?? "BOT",
      type: row.message_type,
      text: row.body_text ?? "",
      time: row.created_at,
      deliveryStatus: row.delivery_status,
      interpretation: row.primary_intent
        ? {
            intent: row.primary_intent,
            confidence:
              row.confidence_score != null ? Number(row.confidence_score) : 0,
            status: row.processing_status,
            fields: interpretationFields(row.structured_output),
          }
        : undefined,
      attachments: attachmentsByMessage.get(row.id) ?? [],
    })),
  );
});

async function deleteConversationMessages(client, conversationId) {
  const msgIds = "SELECT id FROM messages WHERE conversation_id = $1";
  const attIds = `SELECT id FROM attachments WHERE message_id IN (${msgIds})`;

  await client.query(
    `UPDATE workflow_events SET source_message_id = NULL WHERE source_message_id IN (${msgIds})`,
    [conversationId],
  );
  await client.query(
    `UPDATE incidents SET source_message_id = NULL WHERE source_message_id IN (${msgIds})`,
    [conversationId],
  );
  await client.query(
    `DELETE FROM event_confirmations WHERE confirmation_message_id IN (${msgIds})`,
    [conversationId],
  );
  await client.query(
    `DELETE FROM ai_interpretations WHERE message_id IN (${msgIds})`,
    [conversationId],
  );
  await client.query(
    `UPDATE jobs SET pickup_proof_attachment_id = NULL WHERE pickup_proof_attachment_id IN (${attIds})`,
    [conversationId],
  );
  await client.query(
    `UPDATE jobs SET delivery_proof_attachment_id = NULL WHERE delivery_proof_attachment_id IN (${attIds})`,
    [conversationId],
  );

  return client.query("DELETE FROM messages WHERE conversation_id = $1", [
    conversationId,
  ]);
}

router.delete("/:id/messages", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deleted = await deleteConversationMessages(client, req.params.id);
    await client.query(
      "UPDATE conversations SET last_message_at = NULL WHERE id = $1",
      [req.params.id],
    );
    await client.query("COMMIT");

    res.json({ ok: true, deleted: deleted.rowCount });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Clear conversation failed:", err.message);
    res.status(500).json({ error: "Failed to clear conversation" });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteConversationMessages(client, req.params.id);
    const deleted = await client.query(
      "DELETE FROM conversations WHERE id = $1",
      [req.params.id],
    );
    await client.query("COMMIT");

    if (deleted.rowCount === 0)
      return res.status(404).json({ error: "Conversation not found" });
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete conversation failed:", err.message);
    res.status(500).json({ error: "Failed to delete conversation" });
  } finally {
    client.release();
  }
});

router.post("/:id/messages", async (req, res) => {
  const body = (req.body?.body ?? "").trim();
  if (!body) return res.status(400).json({ error: "body is required" });

  const convo = await pool.query(
    `SELECT c.driver_id, wa.phone_e164
       FROM conversations c
       JOIN driver_whatsapp_accounts wa
         ON wa.driver_id = c.driver_id AND wa.is_primary
      WHERE c.id = $1`,
    [req.params.id],
  );
  if (convo.rows.length === 0) {
    return res
      .status(404)
      .json({ error: "Conversation or driver WhatsApp account not found" });
  }
  const { phone_e164 } = convo.rows[0];

  const inserted = await pool.query(
    `INSERT INTO messages (
        conversation_id, sender_type, message_type, source_type,
        body_text, delivery_status, sent_at
     ) VALUES ($1, 'MANAGER', 'TEXT', 'MANUAL_MANAGER_MESSAGE', $2, 'QUEUED', now())
     RETURNING id, created_at`,
    [req.params.id, body],
  );
  const messageId = inserted.rows[0].id;

  try {
    const wamid = await sendTextMessage(phone_e164, `${body}\n\n_Manager_`);
    await pool.query(
      `UPDATE messages
          SET delivery_status = 'SENT', external_message_id = COALESCE($2, external_message_id)
        WHERE id = $1`,
      [messageId, wamid],
    );
  } catch (err) {
    await pool.query(
      `UPDATE messages SET delivery_status = 'FAILED' WHERE id = $1`,
      [messageId],
    );
    console.error("Outbound send failed:", err.message);
    return res.status(502).json({
      error: "Message stored but WhatsApp delivery failed",
      detail: err.message,
    });
  }

  await pool.query(
    `UPDATE conversations SET last_message_at = now() WHERE id = $1`,
    [req.params.id],
  );

  res.status(201).json({
    id: messageId,
    kind: "MANAGER",
    text: body,
    time: inserted.rows[0].created_at,
    deliveryStatus: "SENT",
  });
});

module.exports = router;
