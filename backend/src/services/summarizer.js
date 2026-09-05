const { pool } = require('../db');
const { chatCompletion } = require('../ai/groq');

const NEW_MESSAGES_THRESHOLD = 8;
const STALE_AFTER_MS = 12 * 3600 * 1000;
const MAX_INPUT_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 240;

const SUMMARY_SYSTEM_PROMPT = `You maintain the rolling operations summary of ONE active delivery trip for a logistics fleet.
You receive the previous summary plus the newest WhatsApp messages of the trip. Produce the UPDATED summary:
- Keep it under 200 words, factual, third person, plain text (no markdown, no headings).
- Preserve key facts: milestones reached, quantities/seals, delays, incidents, documents received, verifications, and anything still open.
- Fold in the new messages; drop detail that is now obsolete.
- Never invent facts that are not in the summary or the messages.
Reply with the updated summary text only.`;

async function ensureSummaryRow(jobId, driverId) {
  await pool.query(
    `INSERT INTO job_summaries (job_id, driver_id)
     VALUES ($1, $2)
     ON CONFLICT (job_id) DO NOTHING`,
    [jobId, driverId]
  );
}

function cleanSummary(raw) {
  return String(raw ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:md|markdown)?/gi, '')
    .trim();
}

async function tickAfterMessage(driverId, conversationId) {
  const aR = await pool.query(
    `SELECT ja.job_id, j.current_status
       FROM job_assignments ja JOIN jobs j ON j.id = ja.job_id
      WHERE ja.driver_id = $1
        AND ja.status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
      ORDER BY ja.assigned_at DESC LIMIT 1`,
    [driverId]
  );
  if (aR.rows.length === 0) return;
  const { job_id: jobId, current_status: status } = aR.rows[0];
  if (['COMPLETED', 'CANCELLED'].includes(status)) return;

  await ensureSummaryRow(jobId, driverId);
  const row = (await pool.query(`SELECT * FROM job_summaries WHERE job_id = $1`, [jobId])).rows[0];

  const lastR = await pool.query(
    `SELECT id FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  const lastMessageId = lastR.rows[0]?.id ?? null;
  if (!lastMessageId) return;

  const evR = await pool.query(
    `SELECT 1 FROM workflow_events
      WHERE source_message_id = $1 AND event_status IN ('APPLIED', 'REVIEW_REQUIRED')
      LIMIT 1`,
    [lastMessageId]
  );
  const eventApplied = evR.rows.length > 0;

  const newCount = Number(
    (await pool.query(
      `SELECT count(*) AS c FROM messages WHERE conversation_id = $1 AND created_at > $2`,
      [conversationId, row.updated_at]
    )).rows[0].c
  );
  if (newCount === 0) return;

  const stale = Date.now() - new Date(row.updated_at).getTime() > STALE_AFTER_MS;
  if (!eventApplied && newCount < NEW_MESSAGES_THRESHOLD && !stale) return;

  const msgs = await pool.query(
    `SELECT sender_type, message_type, body_text
       FROM messages
      WHERE conversation_id = $1 AND created_at > $2
      ORDER BY created_at ASC
      LIMIT $3`,
    [conversationId, row.updated_at, MAX_INPUT_MESSAGES]
  );
  const transcript = msgs.rows
    .map((m) => `${m.sender_type}: ${(m.body_text ?? `[${m.message_type}]`).slice(0, MAX_MESSAGE_CHARS)}`)
    .join('\n');

  const userPrompt = [
    `PREVIOUS SUMMARY:\n"""${row.summary_text || '(none yet — this trip just started)'}"""`,
    `NEW MESSAGES:\n"""\n${transcript}\n"""`,
    'Return the updated summary now.',
  ].join('\n\n');

  const updated = cleanSummary(
    await chatCompletion({
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      maxTokens: 300,
    })
  );
  if (!updated) return;

  await pool.query(
    `UPDATE job_summaries
        SET summary_text = $2, last_message_id = $3, message_count = message_count + $4, updated_at = now()
      WHERE job_id = $1`,
    [jobId, updated, lastMessageId, newCount]
  );
}

module.exports = { ensureSummaryRow, tickAfterMessage };
