const express = require('express');
const { pool } = require('../db');
const workflow = require('../services/workflow');
const bot = require('../services/bot');

const router = express.Router();

router.get('/', async (req, res) => {
  const status = req.query.status ?? 'REQUESTED';
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
      WHERE jr.status = $1
      ORDER BY jr.requested_at ASC
      LIMIT 100`,
    [status]
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
