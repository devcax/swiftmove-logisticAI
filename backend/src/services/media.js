const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { pool } = require('../db');
const { downloadMedia } = require('../whatsapp');

function parseR2Config() {
  const raw = process.env.S3_API;
  if (!raw) return null;
  const lastSlash = raw.lastIndexOf('/');
  const endpoint = raw.slice(0, lastSlash);
  const bucket = raw.slice(lastSlash + 1);
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

let s3Client = null;
function getS3Client() {
  const cfg = parseR2Config();
  if (!cfg) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  return s3Client;
}

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

async function storeInboundMedia(messageId, scope = 'general') {
  const client = getS3Client();
  const cfg = parseR2Config();
  if (!client || !cfg) return;

  const rows = await pool.query(
    `SELECT id, attachment_type, storage_key, mime_type
       FROM attachments
      WHERE message_id = $1 AND attachment_type IN ('IMAGE', 'DOCUMENT', 'VIDEO') AND r2_key IS NULL`,
    [messageId]
  );

  for (const row of rows.rows) {
    try {
      const { buffer } = await downloadMedia(row.storage_key);
      const ext = EXT_BY_MIME[row.mime_type] ?? 'bin';
      const key = `media/${scope}/${randomUUID()}.${ext}`;
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: buffer,
          ContentType: row.mime_type ?? 'application/octet-stream',
        })
      );
      const publicUrl = await objectUrl(cfg.bucket, key);
      await pool.query(
        `UPDATE attachments SET r2_key = $2, public_url = $3 WHERE id = $1`,
        [row.id, key, publicUrl]
      );
    } catch (err) {
      console.error(`R2 upload failed for attachment ${row.id}:`, err.message);
    }
  }
}

module.exports = { storeInboundMedia };
