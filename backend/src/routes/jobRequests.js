const express = require('express');
const { pool } = require('../db');
const workflow = require('../services/workflow');
const bot = require('../services/bot');

const router = express.Router();

router.get('/', async (req, res) => {
  const allowedStatuses = new Set([
    'REQUESTED', 'CANCELLED_BY_DRIVER', 'REJECTED', 'APPROVED', 'EXPIRED',
  ]);
  const statuses = String(req.query.status ?? 'REQUESTED')
    .split(',')
    .map((status) => status.trim().toUpperCase())
    .filter((status) => allowedStatuses.has(status));
  if (statuses.length === 0) {
    return res.status(400).json({ error: 'A valid request status is required.' });
  }
  const result = await pool.query(
    `SELECT jr.id, jr.status, jr.requested_at, jr.reviewed_at,
            j.id AS job_id, j.job_number, j.cargo_description, j.pickup_at,
            j.current_status AS job_status,
            pl.name AS pickup, dl.name AS delivery,
            ji.planned_quantity AS quantity, ji.unit,
            d.id AS driver_id, d.name AS driver_name,
            wa.phone_e164 AS driver_phone, wa.verification_status
       FROM job_requests jr
       JOIN jobs j ON j.id = jr.job_id
       LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
       LEFT JOIN locations pl ON pl.id = ps.location_id
       LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
       LEFT JOIN locations dl ON dl.id = ds.location_id
       LEFT JOIN job_items ji ON ji.job_id = j.id
       JOIN drivers d ON d.id = jr.driver_id
       LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
      WHERE jr.status = ANY($1::text[])
      ORDER BY jr.reviewed_at DESC NULLS LAST, jr.requested_at DESC
      LIMIT 100`,
    [statuses]
  );

  res.json(
    result.rows.map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: r.requested_at,
      reviewedAt: r.reviewed_at,
      job: {
        id: r.job_id,
        jobNumber: r.job_number,
        cargo: r.cargo_description,
        pickup: r.pickup,
        delivery: r.delivery,
        quantity: r.quantity != null ? `${r.quantity} ${r.unit ?? ''}`.trim() : null,
        pickupAt: r.pickup_at,
        status: r.job_status,
      },
      driver: {
        id: r.driver_id,
        name: r.driver_name,
        phone: r.driver_phone ?? '',
        verified: r.verification_status === 'VERIFIED',
      },
    }))
  );
});

// Unified history across all three things a driver asks a manager to decide
// on: taking a job, cancelling one, or closing one out. Each source lives in
// its own table (job_requests has a row per ask; cancellations and closures
// are just status transitions on jobs/job_assignments, so their decisions are
// read back from audit_logs) - this merges them into one reverse-chronological
// feed, tagged with `type` so the UI can label each row.
router.get('/history', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM (
       SELECT
         'JOB_REQUEST'::text AS type,
         jr.id::text AS id,
         jr.status AS decision,
         COALESCE(jr.reviewed_at, jr.requested_at) AS decided_at,
         j.id AS job_id, j.job_number, j.cargo_description AS cargo,
         pl.name AS pickup, dl.name AS delivery,
         d.id AS driver_id, d.name AS driver_name,
         wa.phone_e164 AS driver_phone, wa.verification_status
       FROM job_requests jr
       JOIN jobs j ON j.id = jr.job_id
       LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
       LEFT JOIN locations pl ON pl.id = ps.location_id
       LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
       LEFT JOIN locations dl ON dl.id = ds.location_id
       JOIN drivers d ON d.id = jr.driver_id
       LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
      WHERE jr.status IN ('APPROVED', 'REJECTED')

      UNION ALL

      SELECT
        'CANCELLATION'::text AS type,
        al.id::text AS id,
        CASE al.action
          WHEN 'CANCELLATION_RELEASE' THEN 'APPROVED'
          WHEN 'CANCELLATION_CANCEL' THEN 'CANCELLED'
          WHEN 'CANCELLATION_REJECT' THEN 'REJECTED'
          ELSE al.action
        END AS decision,
        al.created_at AS decided_at,
        j.id AS job_id, j.job_number, j.cargo_description AS cargo,
        pl.name AS pickup, dl.name AS delivery,
        d.id AS driver_id, d.name AS driver_name,
        wa.phone_e164 AS driver_phone, wa.verification_status
      FROM audit_logs al
      JOIN jobs j ON j.id = al.entity_id AND al.entity_type = 'JOB'
      LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
      LEFT JOIN locations pl ON pl.id = ps.location_id
      LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
      LEFT JOIN locations dl ON dl.id = ds.location_id
      LEFT JOIN LATERAL (
        SELECT ja.driver_id FROM job_assignments ja
         WHERE ja.job_id = j.id ORDER BY ja.assigned_at DESC LIMIT 1
      ) la ON true
      LEFT JOIN drivers d ON d.id = la.driver_id
      LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
      WHERE al.action IN ('CANCELLATION_RELEASE', 'CANCELLATION_CANCEL', 'CANCELLATION_REJECT')

      UNION ALL

      SELECT
        'CLOSURE'::text AS type,
        al.id::text AS id,
        CASE al.action
          WHEN 'JOB_COMPLETED' THEN 'APPROVED'
          WHEN 'CORRECTION_REQUESTED' THEN 'REQUIRES_CORRECTION'
          ELSE al.action
        END AS decision,
        al.created_at AS decided_at,
        j.id AS job_id, j.job_number, j.cargo_description AS cargo,
        pl.name AS pickup, dl.name AS delivery,
        d.id AS driver_id, d.name AS driver_name,
        wa.phone_e164 AS driver_phone, wa.verification_status
      FROM audit_logs al
      JOIN jobs j ON j.id = al.entity_id AND al.entity_type = 'JOB'
      LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
      LEFT JOIN locations pl ON pl.id = ps.location_id
      LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
      LEFT JOIN locations dl ON dl.id = ds.location_id
      LEFT JOIN LATERAL (
        SELECT ja.driver_id FROM job_assignments ja
         WHERE ja.job_id = j.id ORDER BY ja.assigned_at DESC LIMIT 1
      ) la ON true
      LEFT JOIN drivers d ON d.id = la.driver_id
      LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
      WHERE al.action IN ('JOB_COMPLETED', 'CORRECTION_REQUESTED')
     ) combined
     ORDER BY decided_at DESC
     LIMIT 150`
  );

  res.json(
    result.rows.map((r) => ({
      id: r.id,
      type: r.type,
      decision: r.decision,
      decidedAt: r.decided_at,
      job: {
        id: r.job_id,
        jobNumber: r.job_number,
        cargo: r.cargo,
        pickup: r.pickup,
        delivery: r.delivery,
      },
      driver: {
        id: r.driver_id,
        name: r.driver_name ?? 'Unassigned',
        phone: r.driver_phone ?? '',
        verified: r.verification_status === 'VERIFIED',
      },
    }))
  );
});

router.post('/:id/approve', async (req, res) => {
  try {
    const { job, driver, supersededDrivers } = await workflow.approveRequest(req.params.id);
    await bot.sendJobOffer({ job, driver });
    for (const other of supersededDrivers ?? []) {
      await bot.notifyDriver({
        job,
        driver: other,
        body: `Heads up, *${job.job_number}* was just taken by another driver. Say "jobs" and I'll show you what else is open.`,
      });
    }
    res.json({ ok: true, jobNumber: job.job_number, driver: driver.name });
  } catch (err) {
    if (err instanceof workflow.WorkflowError) {
      return res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ error: err.message, code: err.code });
    }
    console.error('Approve request failed:', err.message);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
    const { job, driver } = await workflow.rejectRequest(req.params.id, undefined, reason);
    await bot.sendRequestRejected({ job, driver });
    res.json({ ok: true, jobNumber: job.job_number, driver: driver.name });
  } catch (err) {
    if (err instanceof workflow.WorkflowError) {
      return res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ error: err.message, code: err.code });
    }
    console.error('Reject request failed:', err.message);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

module.exports = router;
