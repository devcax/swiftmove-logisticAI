const express = require('express');
const { pool } = require('../db');
const { sendTextMessage } = require('../whatsapp');
const { firstName } = require('../ai/companion');

const router = express.Router();

const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

function normalizeSriLankanPhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('0094')) digits = digits.slice(4);
  else if (digits.startsWith('94')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^7\d{8}$/.test(digits)) return null;
  return `+94${digits}`;
}

function normalizeLicensePlate(raw) {
  const upper = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return /^[A-Z]{1,2} ?[A-Z]{1,3}-[0-9]{1,4}$/.test(upper) ? upper : null;
}

function mapDriver(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    verified: r.verification_status === 'VERIFIED',
    status: r.status,
    currentJob: r.current_job ?? null,
    completedTrips: Number(r.completed_trips ?? 0),
    vehicleType: r.vehicle_type ?? null,
    licensePlate: r.license_plate ?? null,
  };
}

const LIST_SQL = `
  SELECT d.id, d.name, d.status, d.vehicle_type, d.license_plate,
         wa.phone_e164 AS phone, wa.verification_status,
         j.job_number AS current_job,
         (SELECT count(*)
            FROM job_assignments ja
            JOIN jobs j2 ON j2.id = ja.job_id
           WHERE ja.driver_id = d.id AND j2.current_status = 'COMPLETED') AS completed_trips
    FROM drivers d
    LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
    LEFT JOIN jobs j ON j.id = d.active_job_id
   WHERE d.organization_id = $1`;

function readAndRespond(req, res, id) {
  pool
    .query(`${LIST_SQL} AND d.id = $2`, [DEMO_ORG_ID, id])
    .then((row) => {
      if (row.rows.length === 0) return res.status(404).json({ error: 'Driver not found.' });
      res.json(mapDriver(row.rows[0]));
    })
    .catch((err) => {
      console.error('readDriver failed:', err.message);
      res.status(500).json({ error: 'Could not load the driver.' });
    });
}

function validatePayload(body, { requireStatus } = {}) {
  const name = String(body?.name ?? '').trim();
  if (name.length < 3) return { error: 'Driver name is required (min. 3 characters).' };

  const phone = normalizeSriLankanPhone(body?.phone);
  if (!phone) return { error: 'Enter a valid Sri Lankan mobile number (e.g. +94 77 123 4567).' };

  const vehicleType = String(body?.vehicleType ?? '').trim();
  if (!vehicleType) return { error: 'Vehicle type is required.' };

  const licensePlate = normalizeLicensePlate(body?.licensePlate);
  if (!licensePlate) return { error: 'License plate is required (e.g. ED-1234 or WP CBA-4412).' };

  const status = String(body?.status ?? 'ACTIVE').toUpperCase();
  if (requireStatus && !STATUSES.includes(status)) return { error: `Invalid status "${body?.status}".` };

  return { value: { name, phone, vehicleType, licensePlate, status } };
}

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(LIST_SQL, [DEMO_ORG_ID]);
    res.json(result.rows.map(mapDriver));
  } catch (err) {
    console.error('listDrivers failed:', err.message);
    res.status(500).json({ error: 'Could not load drivers.' });
  }
});

router.post('/', async (req, res) => {
  const check = validatePayload(req.body);
  if (check.error) return res.status(400).json({ error: check.error });
  const { name, phone, vehicleType, licensePlate } = check.value;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const driver = await client.query(
      `INSERT INTO drivers (organization_id, name, status, vehicle_type, license_plate)
       VALUES ($1, $2, 'ACTIVE', $3, $4)
       RETURNING id`,
      [DEMO_ORG_ID, name, vehicleType, licensePlate]
    );
    await client.query(
      `INSERT INTO driver_whatsapp_accounts (driver_id, phone_e164, is_primary, verification_status)
       VALUES ($1, $2, TRUE, 'VERIFIED')`,
      [driver.rows[0].id, phone]
    );
    await client.query('COMMIT');

    const welcome = [
      `Welcome aboard, ${firstName(name)}! You're registered as a fleet driver${vehicleType ? ` with your ${vehicleType}` : ''}.`,
      '',
      'Everything runs over this WhatsApp chat:',
      '• When a new job fits your vehicle, I send it here with a Confirm button. First to confirm gets it.',
      '• Say "jobs" anytime to see open work that fits your vehicle.',
      '• Say "start" when you begin the trip. Trips can be started from 24 hours before the scheduled pickup, not earlier.',
      '• Keep me posted as you go: "reached pickup", "on my way", "at delivery".',
      '• At pickup and at delivery, send a clear photo of the delivery note. The code on it verifies the stage automatically.',
      '• Running late? Just tell me what is happening and why, and the manager is informed.',
      '• Accident, breakdown, damage, shortage or a refused delivery? Message me what happened, with a photo if you can. It is logged as an incident and the manager is alerted right away.',
      '• Delivered? Say "close the job" and it goes straight to the manager for closure.',
      '',
      'Say "help" anytime to see the command list again. Drive safe!',
    ].join('\n');
    sendTextMessage(phone.replace(/\D/g, ''), welcome)
      .catch((err) => console.error('Driver invite failed:', err.message));

    const row = await pool.query(`${LIST_SQL} AND d.id = $2`, [DEMO_ORG_ID, driver.rows[0].id]);
    res.status(201).json(mapDriver(row.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A driver with this phone number or license plate is already registered.' });
    }
    console.error('createDriver failed:', err.message);
    res.status(500).json({ error: 'Could not create the driver. Please try again.' });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', async (req, res) => {
  const status = String(req.body?.status ?? '').toUpperCase();
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status "${req.body?.status}".` });
  }

  try {
    const updated = await pool.query(`UPDATE drivers SET status = $2 WHERE id = $1 RETURNING id`, [req.params.id, status]);
    if (updated.rows.length === 0) return res.status(404).json({ error: 'Driver not found.' });
    readAndRespond(req, res, req.params.id);
  } catch (err) {
    console.error('updateDriverStatus failed:', err.message);
    res.status(500).json({ error: 'Could not update the driver.' });
  }
});

router.patch('/:id', async (req, res) => {
  const check = validatePayload(req.body, { requireStatus: true });
  if (check.error) return res.status(400).json({ error: check.error });
  const { name, phone, vehicleType, licensePlate, status } = check.value;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE drivers SET name = $2, status = $3, vehicle_type = $4, license_plate = $5
        WHERE id = $1 RETURNING id`,
      [req.params.id, name, status, vehicleType, licensePlate]
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Driver not found.' });
    }

    const existing = await client.query(
      `SELECT id, phone_e164, verification_status FROM driver_whatsapp_accounts WHERE driver_id = $1 AND is_primary`,
      [req.params.id]
    );
    if (existing.rows.length > 0) {
      const previous = existing.rows[0];
      const verificationStatus = previous.phone_e164 === phone ? previous.verification_status : 'UNVERIFIED';
      await client.query(
        `UPDATE driver_whatsapp_accounts SET phone_e164 = $2, verification_status = $3 WHERE id = $1`,
        [previous.id, phone, verificationStatus]
      );
    } else {
      await client.query(
        `INSERT INTO driver_whatsapp_accounts (driver_id, phone_e164, is_primary, verification_status)
         VALUES ($1, $2, TRUE, 'UNVERIFIED')`,
        [req.params.id, phone]
      );
    }

    await client.query('COMMIT');
    readAndRespond(req, res, req.params.id);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A driver with this phone number or license plate is already registered.' });
    }
    console.error('updateDriver failed:', err.message);
    res.status(500).json({ error: 'Could not update the driver. Please try again.' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const driverId = req.params.id;
  const driverMessages = `SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.driver_id = $1`;

  const client = await pool.connect();
  try {
    const exists = await client.query('SELECT id, name FROM drivers WHERE id = $1', [driverId]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Driver not found.' });

    await client.query('BEGIN');

    await client.query(
      `DELETE FROM event_confirmations
        WHERE confirmation_message_id IN (${driverMessages})
           OR workflow_event_id IN (SELECT id FROM workflow_events WHERE source_message_id IN (${driverMessages}))`,
      [driverId]
    );
    await client.query(`UPDATE workflow_events SET source_message_id = NULL WHERE source_message_id IN (${driverMessages})`, [driverId]);
    await client.query(`UPDATE incidents SET source_message_id = NULL WHERE source_message_id IN (${driverMessages})`, [driverId]);
    await client.query(`DELETE FROM ai_interpretations WHERE message_id IN (${driverMessages})`, [driverId]);

    await client.query(
      `WITH driver_attachments AS (
         SELECT a.id
           FROM attachments a
           JOIN messages m ON m.id = a.message_id
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.driver_id = $1
       )
       UPDATE jobs
          SET pickup_proof_attachment_id = CASE
                WHEN pickup_proof_attachment_id IN (SELECT id FROM driver_attachments) THEN NULL
                ELSE pickup_proof_attachment_id
              END,
              delivery_proof_attachment_id = CASE
                WHEN delivery_proof_attachment_id IN (SELECT id FROM driver_attachments) THEN NULL
                ELSE delivery_proof_attachment_id
              END
        WHERE pickup_proof_attachment_id IN (SELECT id FROM driver_attachments)
           OR delivery_proof_attachment_id IN (SELECT id FROM driver_attachments)`,
      [driverId]
    );

    await client.query(`UPDATE notifications SET incident_id = NULL WHERE incident_id IN (SELECT id FROM incidents WHERE reported_by_driver_id = $1)`, [driverId]);
    await client.query(`DELETE FROM incidents WHERE reported_by_driver_id = $1`, [driverId]);

    await client.query(`UPDATE workflow_events SET assignment_id = NULL WHERE assignment_id IN (SELECT id FROM job_assignments WHERE driver_id = $1)`, [driverId]);
    await client.query(`UPDATE incidents SET assignment_id = NULL WHERE assignment_id IN (SELECT id FROM job_assignments WHERE driver_id = $1)`, [driverId]);
    await client.query(`DELETE FROM job_assignments WHERE driver_id = $1`, [driverId]);
    await client.query(`DELETE FROM job_requests WHERE driver_id = $1`, [driverId]);

    await client.query(`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE driver_id = $1)`, [driverId]);
    await client.query(`DELETE FROM conversations WHERE driver_id = $1`, [driverId]);

    await client.query(`UPDATE messages SET sender_driver_id = NULL WHERE sender_driver_id = $1`, [driverId]);
    await client.query(`UPDATE job_summaries SET driver_id = NULL WHERE driver_id = $1`, [driverId]);
    await client.query(`UPDATE audit_logs SET actor_driver_id = NULL WHERE actor_driver_id = $1`, [driverId]);

    await client.query(`DELETE FROM drivers WHERE id = $1`, [driverId]);
    await client.query('COMMIT');

    res.json({ ok: true, id: driverId, name: exists.rows[0].name });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteDriver failed:', err.message);
    res.status(500).json({ error: 'Could not delete the driver. Please try again.' });
  } finally {
    client.release();
  }
});

module.exports = router;
