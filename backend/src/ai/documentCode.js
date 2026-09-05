const { pool } = require("../db");
const whatsapp = require("../whatsapp");
const { chatVision, AI_VISION_MODEL } = require("./groq");

const OUTCOME = {
  OK: "OK",
  UNCLEAR: "UNCLEAR",
  TECH_FAIL: "TECH_FAIL",
};

const EXTRACTION_PROMPT = `You read logistics paperwork photographed by a truck driver.
Return ONLY a JSON object:
{
  "readable": true if the document text is legible enough to read reference codes, false if the photo is blurry, dark, cropped, angled or the code area is not visible,
  "detected_job_number": the job reference printed on the paper (e.g. "JOB-1046"), or null,
  "detected_codes": array of every reference / authorization / security code visible on the paper, verbatim and uppercase, or [],
  "notes": one short sentence describing what makes the image hard to read, or null
}
Rules:
- Only report codes you can actually READ. Never guess, never complete a partially visible code.
- If you can see the paper but no code is legible, set readable=false and detected_codes=[].
- Codes usually look like a short prefixed token, for example PU-7F3K2Q or DL-4M8XQ2.`;

function normalizeCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function extractDocumentCodes(attachmentId, caption = null) {
  const fail = (error) => ({
    outcome: OUTCOME.TECH_FAIL,
    codes: [],
    jobNumber: null,
    notes: null,
    error,
  });

  if (!AI_VISION_MODEL) {
    return fail("No vision model is configured (AI_VISION_MODEL is empty).");
  }

  let att;
  try {
    att = (
      await pool.query(
        `SELECT id, storage_key, mime_type, vision FROM attachments WHERE id = $1`,
        [attachmentId],
      )
    ).rows[0];
  } catch (err) {
    return fail(`Attachment lookup failed: ${err.message}`);
  }
  if (!att) return fail("Attachment not found.");

  if (att.vision?.code_extraction) {
    return att.vision.code_extraction;
  }

  let imageBase64;
  let mimeType = att.mime_type ?? "image/jpeg";
  try {
    const { buffer, mimeType: dlMime } = await whatsapp.downloadMedia(
      att.storage_key,
    );
    imageBase64 = buffer.toString("base64");
    if (dlMime) mimeType = dlMime;
  } catch (err) {
    return fail(`Media download failed: ${err.message}`);
  }

  let raw;
  try {
    raw = await chatVision({
      system: EXTRACTION_PROMPT,
      imageBase64,
      mimeType,
      caption,
      throwOnError: true,
    });
  } catch (err) {
    return fail(`Vision call failed: ${err.message}`);
  }
  if (!raw || typeof raw !== "object") {
    return fail("The document reader returned no usable result.");
  }

  const codes = Array.isArray(raw.detected_codes)
    ? raw.detected_codes
        .map((c) => String(c).trim().toUpperCase())
        .filter(Boolean)
    : [];
  const jobNumber = raw.detected_job_number
    ? String(raw.detected_job_number).trim().toUpperCase()
    : null;
  const notes =
    typeof raw.notes === "string" && raw.notes.trim()
      ? raw.notes.trim().slice(0, 200)
      : null;

  const readable = raw.readable !== false;
  const result =
    readable && codes.length > 0
      ? { outcome: OUTCOME.OK, codes, jobNumber, notes, error: null }
      : { outcome: OUTCOME.UNCLEAR, codes, jobNumber, notes, error: null };

  try {
    await pool.query(
      `UPDATE attachments
          SET vision = COALESCE(vision, '{}'::jsonb) || jsonb_build_object('code_extraction', $2::jsonb)
        WHERE id = $1`,
      [attachmentId, JSON.stringify(result)],
    );
  } catch (err) {
    console.error(
      `Could not cache code extraction for attachment ${attachmentId}:`,
      err.message,
    );
  }

  return result;
}

function matchesExpectedCode({ extraction, expectedCode, jobNumber }) {
  const expected = normalizeCode(expectedCode);
  if (!expected) return { matched: false, reason: "NO_EXPECTED_CODE" };

  const codeOk = extraction.codes.some((c) => normalizeCode(c) === expected);
  if (!codeOk) return { matched: false, reason: "CODE_MISMATCH" };

  if (
    extraction.jobNumber &&
    jobNumber &&
    normalizeCode(extraction.jobNumber) !== normalizeCode(jobNumber)
  ) {
    return { matched: false, reason: "JOB_NUMBER_MISMATCH" };
  }
  return { matched: true, reason: null };
}

module.exports = {
  OUTCOME,
  extractDocumentCodes,
  matchesExpectedCode,
  normalizeCode,
};
