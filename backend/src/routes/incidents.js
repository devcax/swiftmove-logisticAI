const express = require('express');
const { pool } = require('../db');
const workflow = require('../services/workflow');

const router = express.Router();

router.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status) {
    params.push(String(req.query.status).split(','));
    where.push(`i.status = ANY($${params.length})`);
  }
  if (req.query.severity) {
    params.push(String(req.query.severity).split(','));
    where.push(`i.severity = ANY($${params.length})`);
  }

  const result = await pool.query(
    `SELECT i.id, i.incident_type, i.severity, i.status, i.description, i.created_at,
            i.resolved_at, i.manager_notes,
            j.id AS job_id, j.job_number, j.current_status AS job_status,
            d.name AS driver_name
       FROM incidents i
       JOIN jobs j ON j.id = i.job_id
       JOIN drivers d ON d.id = i.reported_by_driver_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY i.created_at DESC
      LIMIT 200`,
    params
  );

  res.json(
    result.rows.map((r) => ({
      id: r.id,
      type: r.incident_type,
      severity: r.severity,
      status: r.status,
      description: r.description,
      reportedAt: r.created_at,
      resolvedAt: r.resolved_at,
      managerNotes: r.manager_notes,
      job: { id: r.job_id, jobNumber: r.job_number, status: r.job_status },
      driver: r.driver_name,
    }))
  );
});

router.get('/:id', async (req, res) => {
  const result = await pool.query(
    `SELECT i.*, j.job_number, j.current_status AS job_status, d.name AS driver_name,
            m.body_text AS source_message, m.created_at AS source_message_at
       FROM incidents i
       JOIN jobs j ON j.id = i.job_id
       JOIN drivers d ON d.id = i.reported_by_driver_id
       LEFT JOIN messages m ON m.id = i.source_message_id
      WHERE i.id = $1`,
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
  const r = result.rows[0];

  const attachments = await pool.query(
    `SELECT a.id, a.attachment_type, a.original_filename, a.mime_type, a.public_url
       FROM incident_attachments ia JOIN attachments a ON a.id = ia.attachment_id
      WHERE ia.incident_id = $1
      ORDER BY ia.created_at`,
    [req.params.id]
  );

  res.json({
    id: r.id,
    type: r.incident_type,
    severity: r.severity,
    status: r.status,
    description: r.description,
    reportedAt: r.created_at,
    resolvedAt: r.resolved_at,
    managerNotes: r.manager_notes,
    job: { id: r.job_id, jobNumber: r.job_number, status: r.job_status },
    driver: r.driver_name,
    sourceMessage: r.source_message ? { text: r.source_message, time: r.source_message_at } : null,
    location:
      r.location_lat != null && r.location_lng != null
        ? { lat: Number(r.location_lat), lng: Number(r.location_lng), receivedAt: r.location_received_at }
        : null,
    backupVehicle: r.backup_vehicle ?? null,
    attachments: attachments.rows.map((a) => ({
      id: a.id,
      type: a.attachment_type,
      filename: a.original_filename,
      mimeType: a.mime_type,
      publicUrl: a.public_url ?? null,
    })),
  });
});

router.patch('/:id', async (req, res) => {
  const notes = typeof req.body?.managerNotes === 'string' ? req.body.managerNotes : null;
  if (notes == null) return res.status(400).json({ error: 'managerNotes is required' });
  const result = await pool.query(
    `UPDATE incidents SET manager_notes = $2 WHERE id = $1 RETURNING id`,
    [req.params.id, notes]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Incident not found' });
  res.json({ ok: true });
});

for (const action of ['resolve', 'under-review', 'keep-open']) {
  router.post(`/:id/${action}`, async (req, res) => {
    try {
      const notes = typeof req.body?.managerNotes === 'string' ? req.body.managerNotes : null;
      const { incident } = await workflow.resolveIncident(req.params.id, action.replace('-', '_'), notes);
      res.json({ ok: true, jobNumber: incident.job_number });
    } catch (err) {
      if (err instanceof workflow.WorkflowError) {
        return res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ error: err.message, code: err.code });
      }
      console.error(`Incident ${action} failed:`, err.message);
      res.status(500).json({ error: 'Failed to update incident' });
    }
  });
}

module.exports = router;
