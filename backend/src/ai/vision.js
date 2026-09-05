const { pool } = require('../db');
const whatsapp = require('../whatsapp');
const { chatVision, AI_VISION_MODEL } = require('./groq');

const SCENE_CLASSES = ['ACCIDENT', 'BREAKDOWN', 'DAMAGE', 'CARGO', 'PICKUP_PAPER', 'DELIVERY_PAPER', 'POD', 'OTHER'];

function visionAvailable() {
  return Boolean(AI_VISION_MODEL);
}

const VISION_SYSTEM_PROMPT = `You are a logistics fleet image classifier. Analyze the driver's photo and respond with ONLY a JSON object:
{
  "scene_class": one of ACCIDENT | BREAKDOWN | DAMAGE | CARGO | PICKUP_PAPER | DELIVERY_PAPER | POD | OTHER,
  "description": one short sentence of what the photo shows,
  "detected_job_number": the job reference printed on any visible paperwork (e.g. "JOB-1046"), or null,
  "detected_codes": array of any security/authorization codes or reference codes visible on paperwork (verbatim, uppercase), or [],
  "severity_hint": for ACCIDENT/BREAKDOWN/DAMAGE one of LOW | MEDIUM | HIGH | CRITICAL (danger to people or vehicle = CRITICAL), otherwise null
}
Rules:
- PICKUP_PAPER = signed pickup document / delivery note for collection; DELIVERY_PAPER = signed delivery document; POD = proof of delivery receipt.
- ACCIDENT = collision/vehicle damage scene; BREAKDOWN = stopped vehicle/mechanical issue; DAMAGE = damaged cargo or property.
- Only report codes and job numbers you can actually READ in the image; never guess.`;

async function analyzeAttachment(attachmentId, caption = null) {
  if (!visionAvailable()) return null;

  const att = (await pool.query(
    `SELECT id, storage_key, mime_type, vision FROM attachments WHERE id = $1`,
    [attachmentId]
  )).rows[0];
  if (!att) return null;
  if (att.vision?.scene_class) return att.vision;

  let imageBase64;
  let mimeType = att.mime_type ?? 'image/jpeg';
  try {
    const { buffer, mimeType: dlMime } = await whatsapp.downloadMedia(att.storage_key);
    imageBase64 = buffer.toString('base64');
    if (dlMime) mimeType = dlMime;
  } catch (err) {
    console.error(`Vision download failed for attachment ${attachmentId}:`, err.message);
    return null;
  }

  const result = await chatVision({ system: VISION_SYSTEM_PROMPT, imageBase64, mimeType, caption });
  if (!result || !SCENE_CLASSES.includes(result.scene_class)) return null;

  const normalized = {
    scene_class: result.scene_class,
    description: String(result.description ?? '').slice(0, 500),
    detected_job_number: result.detected_job_number ? String(result.detected_job_number).trim().toUpperCase() : null,
    detected_codes: Array.isArray(result.detected_codes)
      ? result.detected_codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
      : [],
    severity_hint: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(result.severity_hint) ? result.severity_hint : null,
  };
  await pool.query(`UPDATE attachments SET vision = $2 WHERE id = $1`, [attachmentId, JSON.stringify(normalized)]);
  return normalized;
}

module.exports = { visionAvailable, analyzeAttachment, SCENE_CLASSES };
