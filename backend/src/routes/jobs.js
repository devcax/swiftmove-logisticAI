const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const workflow = require('../services/workflow');
const bot = require('../services/bot');
const jobOffers = require('../services/jobOffers');
const { interpretationFields } = require('../services/format');
const { parseInstant } = require('../time');

const router = express.Router();

function offerJobInBackground(jobId) {
  jobOffers.offerPublishedJob(jobId).catch((err) => console.error('Job offer matching failed:', err.message));
}

const KIND_MAP = { DRIVER: 'DRIVER', MANAGER: 'MANAGER', BOT: 'BOT', SYSTEM: 'BOT' };

const LIVE_STATUSES = [
  'MANAGER_APPROVED', 'ASSIGNMENT_SENT', 'ASSIGNED', 'IN_PROGRESS',
  'ARRIVED_AT_PICKUP', 'LOADING_STARTED', 'LOADED', 'DEPARTED',
  'ARRIVED_AT_DELIVERY', 'UNLOADING_STARTED', 'UNLOADED',
  'DELAYED', 'INCIDENT_OPEN', 'CANCELLATION_REVIEW',
  'DELIVERED', 'DELIVERED_WITH_EXCEPTION',
  'DRIVER_SUBMITTED_COMPLETION', 'MANAGER_REVIEW', 'REQUIRES_CORRECTION',
];

const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_MANAGER_ID = '00000000-0000-0000-0000-000000000010';

function generateJobNumber() {
  return `JOB-${Date.now().toString().slice(-6)}${crypto.randomInt(0, 100).toString().padStart(2, '0')}`;
}

function generateSecurityCode(prefix) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body = '';
  for (let i = 0; i < 6; i += 1) body += alphabet[crypto.randomInt(alphabet.length)];
  return `${prefix}-${body}`;
}

function handleError(res, err, fallback) {
  if (err instanceof workflow.WorkflowError) {
    return res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ error: err.message, code: err.code });
  }
  console.error(fallback, err.message);
  return res.status(500).json({ error: fallback });
}

router.get('/', async (req, res) => {
  const { status, search } = req.query;
  const params = [];
  const where = [];
  if (status) {
    params.push(String(status).split(','));
    where.push(`j.current_status = ANY($${params.length})`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(j.job_number ILIKE $${params.length} OR j.cargo_description ILIKE $${params.length})`);
  }

  const result = await pool.query(
    `SELECT j.id, j.job_number, j.current_status, j.cargo_description, j.pickup_at, j.delivery_at,
            pl.name AS pickup, dl.name AS delivery,
            ji.planned_quantity AS quantity, ji.unit,
            d.name AS driver_name, ja.cancellation_reason,
            (SELECT ja3.status FROM job_assignments ja3
              WHERE ja3.job_id = j.id AND ja3.status = 'PENDING_DRIVER_ACCEPTANCE'
              LIMIT 1) AS assignment_status
       FROM jobs j
       LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
       LEFT JOIN locations pl ON pl.id = ps.location_id
       LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
       LEFT JOIN locations dl ON dl.id = ds.location_id
       LEFT JOIN job_items ji ON ji.job_id = j.id
       LEFT JOIN LATERAL (
         SELECT ja2.driver_id, ja2.cancellation_reason
           FROM job_assignments ja2
          WHERE ja2.job_id = j.id
            AND (
              j.current_status = 'COMPLETED'
              OR ja2.status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW', 'COMPLETED')
            )
          ORDER BY
            CASE
              WHEN j.current_status = 'COMPLETED' AND ja2.status = 'COMPLETED' THEN 0
              WHEN ja2.status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW') THEN 1
              ELSE 2
            END,
            ja2.completed_at DESC NULLS LAST,
            ja2.assigned_at DESC
          LIMIT 1
       ) ja ON true
       LEFT JOIN drivers d ON d.id = ja.driver_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY j.created_at DESC
      LIMIT 200`,
    params
  );

  res.json(
    result.rows.map((r) => ({
      id: r.id,
      jobNumber: r.job_number,
      status: r.current_status,
      cargo: r.cargo_description,
      pickup: r.pickup,
      delivery: r.delivery,
      quantity: r.quantity != null ? `${r.quantity} ${r.unit ?? ''}`.trim() : null,
      pickupAt: r.pickup_at,
      deliveryAt: r.delivery_at,
      driver: r.driver_name,
      cancellationReason: r.cancellation_reason ?? null,
      assignmentStatus: r.assignment_status ?? null,
    }))
  );
});

async function findOrCreateLocation(client, name) {
  const existing = await client.query(
    `SELECT id FROM locations WHERE organization_id = $1 AND lower(name) = lower($2)`,
    [DEMO_ORG_ID, name]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await client.query(
    `INSERT INTO locations (organization_id, name, address_line_1, city, country)
     VALUES ($1, $2, $2, 'Sri Lanka', 'Sri Lanka')
     RETURNING id`,
    [DEMO_ORG_ID, name]
  );
  return created.rows[0].id;
}

router.post('/', async (req, res) => {
  const b = req.body ?? {};
  const pickupLocation = String(b.pickupLocation ?? '').trim();
  const deliveryLocation = String(b.deliveryLocation ?? '').trim();
  const cargo = String(b.cargo ?? '').trim();
  if (!pickupLocation || !deliveryLocation || !cargo) {
    return res.status(400).json({ error: 'Pickup location, delivery location and cargo are required.' });
  }
  const status = b.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED';

  const jobNumber = String(b.jobNumber ?? '').trim() || generateJobNumber();
  const pickupCode = String(b.pickupCode ?? '').trim().slice(0, 40) || generateSecurityCode('PU');
  const deliveryCode = String(b.deliveryCode ?? '').trim().slice(0, 40) || generateSecurityCode('DL');

  const pickupAt = parseInstant(b.pickupAt) ?? new Date(Date.now() + 24 * 3600 * 1000);
  const deliveryAt = parseInstant(b.deliveryAt);

  if (deliveryAt
      && (deliveryAt.getTime() <= pickupAt.getTime()
          || deliveryAt.getTime() > pickupAt.getTime() + 2 * 24 * 3600 * 1000)) {
    return res.status(400).json({ error: 'Delivery must be after the pickup and within 2 days of it.' });
  }

  const rawQuantity = Number.parseInt(String(b.quantity ?? ''), 10);
  const quantity = Number.isNaN(rawQuantity) || rawQuantity < 0 ? null : rawQuantity;
  const unit = String(b.unit ?? '').trim() || 'Units';
  const instructions = String(b.instructions ?? '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pickupId = await findOrCreateLocation(client, pickupLocation);
    const deliveryId = await findOrCreateLocation(client, deliveryLocation);

    const job = await client.query(
      `INSERT INTO jobs (
         organization_id, job_number, current_status, cargo_description,
         pickup_at, delivery_at, special_instructions, published_at, created_by_user_id,
         pickup_code, delivery_code
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, job_number, current_status`,
      [
        DEMO_ORG_ID, jobNumber, status, cargo,
        pickupAt, deliveryAt, instructions,
        status === 'PUBLISHED' ? new Date() : null,
        DEMO_MANAGER_ID,
        pickupCode, deliveryCode,
      ]
    );
    const jobId = job.rows[0].id;

    if (quantity != null) {
      await client.query(
        `INSERT INTO job_items (job_id, description, planned_quantity, unit)
         VALUES ($1, $2, $3, $4)`,
        [jobId, cargo, quantity, unit]
      );
    }
    await client.query(
      `INSERT INTO job_stops (job_id, location_id, stop_sequence, stop_type, appointment_at)
       VALUES ($1, $2, 1, 'PICKUP', $4), ($1, $3, 2, 'DELIVERY', $5)`,
      [jobId, pickupId, deliveryId, pickupAt, deliveryAt]
    );

    await client.query('COMMIT');
    if (status === 'PUBLISHED') offerJobInBackground(jobId);
    res.status(201).json({
      id: jobId,
      jobNumber: job.rows[0].job_number,
      status: job.rows[0].current_status,
      cargo,
      pickup: pickupLocation,
      delivery: deliveryLocation,
      quantity: quantity != null ? `${quantity} ${unit}` : null,
      pickupAt,
      deliveryAt,
      pickupCode,
      deliveryCode,
      driver: null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: `Job number ${jobNumber} already exists.` });
    }
    console.error('createJob failed:', err.message);
    res.status(500).json({ error: 'Could not save the job. Please try again.' });
  } finally {
    client.release();
  }
});

router.get('/next-identifiers', (req, res) => {
  res.json({
    jobNumber: generateJobNumber(),
    pickupCode: generateSecurityCode('PU'),
    deliveryCode: generateSecurityCode('DL'),
  });
});

router.get('/live', async (req, res) => {
  const result = await pool.query(
    `SELECT j.id, j.job_number, j.current_status, j.cargo_description, j.pickup_at, j.delivery_at,
            pl.name AS pickup, dl.name AS delivery,
            ji.planned_quantity AS quantity, ji.unit,
            d.name AS driver_name, wa.phone_e164 AS driver_phone, ja.cancellation_reason,
            le.event_type AS last_event_type, le.created_at AS last_event_at,
            (SELECT count(*)::int FROM incidents i WHERE i.job_id = j.id AND i.status <> 'RESOLVED') AS open_incidents
       FROM jobs j
       LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
       LEFT JOIN locations pl ON pl.id = ps.location_id
       LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
       LEFT JOIN locations dl ON dl.id = ds.location_id
       LEFT JOIN job_items ji ON ji.job_id = j.id
       LEFT JOIN job_assignments ja ON ja.job_id = j.id
            AND ja.status IN ('PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
       LEFT JOIN drivers d ON d.id = ja.driver_id
       LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
       LEFT JOIN LATERAL (
         SELECT we.event_type, we.created_at
           FROM workflow_events we
          WHERE we.job_id = j.id
          ORDER BY we.created_at DESC
          LIMIT 1
       ) le ON TRUE
      WHERE j.current_status = ANY($1)
      ORDER BY le.created_at DESC NULLS LAST, j.created_at DESC
      LIMIT 200`,
    [LIVE_STATUSES]
  );

  res.json(
    result.rows.map((r) => ({
      id: r.id,
      jobNumber: r.job_number,
      status: r.current_status,
      cargo: r.cargo_description,
      pickup: r.pickup,
      delivery: r.delivery,
      quantity: r.quantity != null ? `${r.quantity} ${r.unit ?? ''}`.trim() : null,
      pickupAt: r.pickup_at,
      deliveryAt: r.delivery_at,
      driver: r.driver_name,
      driverPhone: r.driver_phone ?? null,
      cancellationReason: r.cancellation_reason ?? null,
      lastEventType: r.last_event_type ?? null,
      lastEventAt: r.last_event_at ?? null,
      openIncidents: r.open_incidents ?? 0,
    }))
  );
});

async function loadJobDetail(jobId) {
  const jobR = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (jobR.rows.length === 0) return null;
  const job = jobR.rows[0];

  const stops = await pool.query(
    `SELECT js.stop_type, js.stop_sequence, l.name, l.address_line_1, l.city
       FROM job_stops js JOIN locations l ON l.id = js.location_id
      WHERE js.job_id = $1 ORDER BY js.stop_sequence`,
    [jobId]
  );
  const items = await pool.query(
    `SELECT description, planned_quantity, unit FROM job_items WHERE job_id = $1`,
    [jobId]
  );
  const assignment = await pool.query(
    `SELECT ja.id, ja.status, ja.assigned_at, ja.accepted_at, ja.started_at,
            ja.completion_submitted_at, ja.cancellation_reason,
            d.id AS driver_id, d.name AS driver_name, wa.phone_e164 AS driver_phone
       FROM job_assignments ja
       JOIN drivers d ON d.id = ja.driver_id
       LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
      WHERE ja.job_id = $1
      ORDER BY ja.assigned_at DESC LIMIT 1`,
    [jobId]
  );

  return { job, stops: stops.rows, items: items.rows, assignment: assignment.rows[0] ?? null };
}

router.get('/:id', async (req, res) => {
  const detail = await loadJobDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Job not found' });
  const { job, stops, items, assignment } = detail;

  res.json({
    id: job.id,
    jobNumber: job.job_number,
    status: job.current_status,
    cargo: job.cargo_description,
    specialInstructions: job.special_instructions,
    pickupAt: job.pickup_at,
    deliveryAt: job.delivery_at,
    completedAt: job.completed_at,
    pickupCode: job.pickup_code ?? null,
    deliveryCode: job.delivery_code ?? null,
    pickupVerifiedAt: job.pickup_verified_at,
    deliveryVerifiedAt: job.delivery_verified_at,
    pickupActualAt: job.pickup_actual_at ?? null,
    deliveryActualAt: job.delivery_actual_at ?? null,
    pickupDelayReason: job.pickup_delay_reason ?? null,
    deliveryDelayReason: job.delivery_delay_reason ?? null,
    stops: stops.map((s) => ({
      type: s.stop_type,
      name: s.name,
      address: [s.address_line_1, s.city].filter(Boolean).join(', '),
    })),
    items: items.map((i) => ({
      description: i.description,
      quantity: i.planned_quantity != null ? `${i.planned_quantity} ${i.unit ?? ''}`.trim() : null,
      quantityValue: i.planned_quantity != null ? Number(i.planned_quantity) : null,
      unit: i.unit ?? null,
    })),
    assignment: assignment
      ? {
          id: assignment.id,
          status: assignment.status,
          assignedAt: assignment.assigned_at,
          acceptedAt: assignment.accepted_at,
          startedAt: assignment.started_at,
          completionSubmittedAt: assignment.completion_submitted_at,
          cancellationReason: assignment.cancellation_reason,
          driver: {
            id: assignment.driver_id,
            name: assignment.driver_name,
            phone: assignment.driver_phone ?? '',
          },
        }
      : null,
  });
});

router.get('/:id/timeline', async (req, res) => {
  const events = await pool.query(
    `SELECT we.id, we.event_type, we.event_status, we.event_data, we.confidence_score,
            we.applied_at, we.created_at,
            m.body_text AS source_message
       FROM workflow_events we
       LEFT JOIN messages m ON m.id = we.source_message_id
      WHERE we.job_id = $1
      ORDER BY we.created_at ASC
      LIMIT 300`,
    [req.params.id]
  );

  res.json(
    events.rows.map((e) => ({
      id: e.id,
      type: e.event_type,
      status: e.event_status,
      data: e.event_data,
      confidence: e.confidence_score != null ? Number(e.confidence_score) : null,
      appliedAt: e.applied_at,
      time: e.created_at,
      sourceMessage: e.source_message,
    }))
  );
});

router.get('/:id/activity', async (req, res) => {
  const job = await pool.query('SELECT id, created_at FROM jobs WHERE id = $1', [req.params.id]);
  if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

  const SCOPE_SQL = `
    WITH cutoff AS (
      SELECT COALESCE(
        LEAST(
          (SELECT MIN(requested_at) FROM job_requests WHERE job_id = $1),
          (SELECT MIN(assigned_at) FROM job_assignments WHERE job_id = $1)
        ),
        (SELECT created_at FROM jobs WHERE id = $1)
      ) AS t
    ),
    job_drivers AS (
      SELECT driver_id FROM job_requests WHERE job_id = $1
      UNION
      SELECT driver_id FROM job_assignments WHERE job_id = $1
    )
  `;

  const messages = await pool.query(
    `${SCOPE_SQL}
     SELECT m.id, m.sender_type, m.message_type, m.body_text, m.delivery_status, m.created_at,
            ai.primary_intent, ai.confidence_score, ai.processing_status, ai.structured_output
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN job_drivers jd ON jd.driver_id = c.driver_id
       CROSS JOIN cutoff
       LEFT JOIN ai_interpretations ai ON ai.message_id = m.id
      WHERE m.created_at >= cutoff.t
      ORDER BY m.created_at ASC
      LIMIT 500`,
    [req.params.id]
  );

  const attachments = await pool.query(
    `${SCOPE_SQL}
     SELECT a.id, a.message_id, a.attachment_type, a.original_filename, a.mime_type, a.public_url, a.created_at
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN conversations c ON c.id = m.conversation_id
       JOIN job_drivers jd ON jd.driver_id = c.driver_id
       CROSS JOIN cutoff
      WHERE m.created_at >= cutoff.t
      ORDER BY a.created_at ASC`,
    [req.params.id]
  );

  const byMessage = new Map();
  for (const a of attachments.rows) {
    const list = byMessage.get(a.message_id) ?? [];
    list.push({
      id: a.id,
      type: a.attachment_type,
      filename: a.original_filename,
      mimeType: a.mime_type,
      publicUrl: a.public_url ?? null,
      createdAt: a.created_at,
    });
    byMessage.set(a.message_id, list);
  }

  res.json({
    messages: messages.rows.map((row) => ({
      id: row.id,
      kind: KIND_MAP[row.sender_type] ?? 'BOT',
      type: row.message_type,
      text: row.body_text ?? '',
      time: row.created_at,
      deliveryStatus: row.delivery_status,
      interpretation: row.primary_intent
        ? {
            intent: row.primary_intent,
            confidence: row.confidence_score != null ? Number(row.confidence_score) : 0,
            status: row.processing_status,
            fields: interpretationFields(row.structured_output),
          }
        : undefined,
      attachments: byMessage.get(row.id) ?? [],
    })),
  });
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
    const { job, driver } = await workflow.managerCancelJob(req.params.id, reason);
    await bot.sendJobCancelled({ job, driver });
    res.json({ ok: true, status: 'CANCELLED' });
  } catch (err) {
    handleError(res, err, 'Failed to cancel job');
  }
});

router.post('/:id/cancellation-decision', async (req, res) => {
  try {
    const action = req.body?.action;
    const { job, driver } = await workflow.resolveCancellation(req.params.id, action);
    await bot.sendCancellationDecision({ job, driver, action });
    res.json({ ok: true, status: job.current_status, action });
  } catch (err) {
    handleError(res, err, 'Failed to resolve cancellation');
  }
});

router.post('/:id/release-driver', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 500)
      : null;
    const { job, driver } = await workflow.releaseDriver(req.params.id, { reason });
    if (driver?.phone_e164) {
      await bot.notifyDriver({
        job,
        driver,
        body: `You've been released from *${job.job_number}* by the manager${reason ? ` (${reason})` : ''}. You're available for other jobs again — say "jobs" and I'll show you what's open.`,
      });
    }
    offerJobInBackground(job.id);
    res.json({ ok: true, status: job.current_status });
  } catch (err) {
    handleError(res, err, 'Failed to release driver');
  }
});

router.post('/:id/reset', async (req, res) => {
  try {
    const { job } = await workflow.resetJob(req.params.id, {
      pickupCode: generateSecurityCode('PU'),
      deliveryCode: generateSecurityCode('DL'),
    });
    if (job.current_status === 'PUBLISHED') offerJobInBackground(job.id);
    res.json(await loadJobSummary(req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to reset job');
  }
});

router.post('/:id/request-correction', async (req, res) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    const { job, driver } = await workflow.requestCorrection(req.params.id, note);
    await bot.sendCorrectionRequest({ job, driver, note });
    res.json({ ok: true, status: 'REQUIRES_CORRECTION' });
  } catch (err) {
    handleError(res, err, 'Failed to request correction');
  }
});

router.post('/:id/submit-completion', async (req, res) => {
  try {
    const { job, driver } = await workflow.submitCompletion(req.params.id);
    await bot.sendCompletionSubmitted({ job, driver });
    res.json({ ok: true, status: 'MANAGER_REVIEW' });
  } catch (err) {
    handleError(res, err, 'Failed to submit job for closure');
  }
});

router.post('/:id/verify', async (req, res) => {
  const stage = String(req.body?.stage ?? '').toUpperCase();
  if (!['PICKUP', 'DELIVERY'].includes(stage)) {
    return res.status(400).json({ error: "stage must be 'PICKUP' or 'DELIVERY'." });
  }
  try {
    const result = await workflow.verifyStageByManager(req.params.id, stage, DEMO_MANAGER_ID);
    if (!result.alreadyVerified && result.driver?.phone_e164) {
      await bot.sendManagerVerification({ job: result.job, driver: result.driver, stage });
    }
    res.json({
      ok: true,
      stage,
      verifiedAt: stage === 'PICKUP' ? result.job.pickup_verified_at : result.job.delivery_verified_at,
      status: result.newStatus,
      alreadyVerified: result.alreadyVerified,
    });
  } catch (err) {
    handleError(res, err, 'Failed to verify the document');
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const { job, driver, alreadyCompleted } = await workflow.completeJob(req.params.id);
    if (!alreadyCompleted) await bot.sendJobCompleted({ job, driver });
    res.json({ ok: true, status: 'COMPLETED', alreadyCompleted: Boolean(alreadyCompleted) });
  } catch (err) {
    handleError(res, err, 'Failed to complete job');
  }
});

async function loadJobSummary(jobId) {
  const result = await pool.query(
    `SELECT j.id, j.job_number, j.current_status, j.cargo_description, j.pickup_at, j.delivery_at,
            pl.name AS pickup, dl.name AS delivery,
            ji.planned_quantity AS quantity, ji.unit,
            d.name AS driver_name, ja.cancellation_reason,
            (SELECT ja3.status FROM job_assignments ja3
              WHERE ja3.job_id = j.id AND ja3.status = 'PENDING_DRIVER_ACCEPTANCE'
              LIMIT 1) AS assignment_status
       FROM jobs j
       LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
       LEFT JOIN locations pl ON pl.id = ps.location_id
       LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
       LEFT JOIN locations dl ON dl.id = ds.location_id
       LEFT JOIN job_items ji ON ji.job_id = j.id
       LEFT JOIN LATERAL (
         SELECT ja2.driver_id, ja2.cancellation_reason
           FROM job_assignments ja2
          WHERE ja2.job_id = j.id
            AND (
              j.current_status = 'COMPLETED'
              OR ja2.status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW', 'COMPLETED')
            )
          ORDER BY
            CASE
              WHEN j.current_status = 'COMPLETED' AND ja2.status = 'COMPLETED' THEN 0
              WHEN ja2.status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW') THEN 1
              ELSE 2
            END,
            ja2.completed_at DESC NULLS LAST,
            ja2.assigned_at DESC
          LIMIT 1
       ) ja ON true
       LEFT JOIN drivers d ON d.id = ja.driver_id
      WHERE j.id = $1`,
    [jobId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    jobNumber: r.job_number,
    status: r.current_status,
    cargo: r.cargo_description,
    pickup: r.pickup,
    delivery: r.delivery,
    quantity: r.quantity != null ? `${r.quantity} ${r.unit ?? ''}`.trim() : null,
    pickupAt: r.pickup_at,
    deliveryAt: r.delivery_at,
    driver: r.driver_name,
    cancellationReason: r.cancellation_reason ?? null,
    assignmentStatus: r.assignment_status ?? null,
  };
}

router.patch('/:id', async (req, res) => {
  const b = req.body ?? {};
  const pickupLocation = String(b.pickupLocation ?? '').trim();
  const deliveryLocation = String(b.deliveryLocation ?? '').trim();
  const cargo = String(b.cargo ?? '').trim();
  if (!pickupLocation || !deliveryLocation || !cargo) {
    return res.status(400).json({ error: 'Pickup location, delivery location and cargo are required.' });
  }

  const pickupAt = parseInstant(b.pickupAt);
  const deliveryAt = parseInstant(b.deliveryAt);
  const rawQuantity = Number.parseInt(String(b.quantity ?? ''), 10);
  const quantity = Number.isNaN(rawQuantity) || rawQuantity < 0 ? null : rawQuantity;
  const unit = String(b.unit ?? '').trim() || 'Units';
  const instructions = String(b.instructions ?? '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobR = await client.query('SELECT id, current_status FROM jobs WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (jobR.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }
    if (!['DRAFT', 'PUBLISHED'].includes(jobR.rows[0].current_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only draft or published jobs can be edited.' });
    }

    const pickupId = await findOrCreateLocation(client, pickupLocation);
    const deliveryId = await findOrCreateLocation(client, deliveryLocation);

    await client.query(
      `UPDATE jobs
          SET cargo_description = $2,
              pickup_at = COALESCE($3, pickup_at),
              delivery_at = $4,
              special_instructions = $5
        WHERE id = $1`,
      [req.params.id, cargo, pickupAt, deliveryAt, instructions]
    );
    await client.query(
      `UPDATE job_stops SET location_id = $2, appointment_at = COALESCE($3, appointment_at)
        WHERE job_id = $1 AND stop_type = 'PICKUP'`,
      [req.params.id, pickupId, pickupAt]
    );
    await client.query(
      `UPDATE job_stops SET location_id = $2, appointment_at = $3
        WHERE job_id = $1 AND stop_type = 'DELIVERY'`,
      [req.params.id, deliveryId, deliveryAt]
    );
    if (quantity != null) {
      const updated = await client.query(
        `UPDATE job_items SET description = $2, planned_quantity = $3, unit = $4
          WHERE id = (SELECT id FROM job_items WHERE job_id = $1 ORDER BY created_at LIMIT 1)`,
        [req.params.id, cargo, quantity, unit]
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO job_items (job_id, description, planned_quantity, unit) VALUES ($1, $2, $3, $4)`,
          [req.params.id, cargo, quantity, unit]
        );
      }
    }

    await client.query('COMMIT');
    res.json(await loadJobSummary(req.params.id));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateJob failed:', err.message);
    res.status(500).json({ error: 'Could not update the job. Please try again.' });
  } finally {
    client.release();
  }
});

router.post('/:id/deactivate', async (req, res) => {
  const jobId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobR = await client.query(
      'SELECT id, job_number, current_status FROM jobs WHERE id = $1 FOR UPDATE',
      [jobId]
    );
    if (jobR.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = jobR.rows[0];
    if (['COMPLETED', 'CANCELLED'].includes(job.current_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Job ${job.job_number} is already ${job.current_status.toLowerCase()}.` });
    }

    await client.query(`UPDATE jobs SET current_status = 'CANCELLED' WHERE id = $1`, [jobId]);
    await client.query(
      `UPDATE job_requests SET status = 'EXPIRED' WHERE job_id = $1 AND status = 'REQUESTED'`,
      [jobId]
    );
    await client.query(
      `UPDATE job_assignments SET status = 'CANCELLED', cancelled_at = now()
        WHERE job_id = $1 AND status IN ('PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')`,
      [jobId]
    );
    await client.query('UPDATE drivers SET active_job_id = NULL WHERE active_job_id = $1', [jobId]);

    await client.query('COMMIT');
    res.json({ ok: true, id: jobId, status: 'CANCELLED' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deactivateJob failed:', err.message);
    res.status(500).json({ error: 'Could not deactivate the job. Please try again.' });
  } finally {
    client.release();
  }
});

router.post('/:id/activate', async (req, res) => {
  try {
    const jobR = await pool.query('SELECT id, job_number, current_status FROM jobs WHERE id = $1', [req.params.id]);
    if (jobR.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const job = jobR.rows[0];
    if (job.current_status !== 'CANCELLED') {
      return res
        .status(409)
        .json({ error: `Only cancelled jobs can be reactivated (${job.job_number} is ${job.current_status.toLowerCase()}).` });
    }

    await pool.query(
      `UPDATE jobs SET current_status = 'PUBLISHED', published_at = COALESCE(published_at, now()) WHERE id = $1`,
      [req.params.id]
    );
    offerJobInBackground(req.params.id);
    res.json({ ok: true, id: req.params.id, status: 'PUBLISHED' });
  } catch (err) {
    console.error('activateJob failed:', err.message);
    res.status(500).json({ error: 'Could not reactivate the job. Please try again.' });
  }
});

router.delete('/:id', async (req, res) => {
  const jobId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, job_number FROM jobs WHERE id = $1', [jobId]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }

    await client.query('UPDATE drivers SET active_job_id = NULL WHERE active_job_id = $1', [jobId]);
    await client.query('UPDATE conversations SET job_id = NULL WHERE job_id = $1', [jobId]);

    await client.query('DELETE FROM notifications WHERE job_id = $1', [jobId]);
    await client.query(
      `DELETE FROM event_confirmations
        WHERE workflow_event_id IN (SELECT id FROM workflow_events WHERE job_id = $1)`,
      [jobId]
    );
    await client.query('DELETE FROM workflow_events WHERE job_id = $1', [jobId]);
    await client.query('DELETE FROM incidents WHERE job_id = $1', [jobId]);
    await client.query('DELETE FROM job_requests WHERE job_id = $1', [jobId]);
    await client.query('DELETE FROM job_assignments WHERE job_id = $1', [jobId]);
    await client.query('DELETE FROM jobs WHERE id = $1', [jobId]);

    await client.query('COMMIT');
    res.json({ ok: true, id: jobId, jobNumber: existing.rows[0].job_number });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteJob failed:', err.message);
    res.status(500).json({ error: 'Could not delete the job. Please try again.' });
  } finally {
    client.release();
  }
});

module.exports = router;
