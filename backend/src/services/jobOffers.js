const { pool } = require('../db');
const workflow = require('./workflow');
const bot = require('./bot');
const { matchDriversForJob } = require('../ai/vehicleMatch');

async function offerPublishedJob(jobId) {
  try {
    const job = (await pool.query(
      `SELECT j.id, j.organization_id, j.job_number, j.current_status, j.cargo_description,
              j.pickup_at, j.delivery_at,
              pl.name AS pickup, dl.name AS delivery,
              ji.planned_quantity AS quantity, ji.unit
         FROM jobs j
         LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
         LEFT JOIN locations pl ON pl.id = ps.location_id
         LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
         LEFT JOIN locations dl ON dl.id = ds.location_id
         LEFT JOIN job_items ji ON ji.job_id = j.id
        WHERE j.id = $1`,
      [jobId]
    )).rows[0];
    if (!job || job.current_status !== 'PUBLISHED') return { offered: 0, matched: 0, candidates: 0, skipped: 'NOT_PUBLISHED' };

    const items = (await pool.query(
      'SELECT description, planned_quantity, unit FROM job_items WHERE job_id = $1',
      [job.id]
    )).rows;

    const candidates = (await pool.query(
      `SELECT d.id, d.name, d.vehicle_type, wa.phone_e164
         FROM drivers d
         JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
        WHERE d.organization_id = $1
          AND d.status = 'ACTIVE'
          AND d.active_job_id IS NULL
          AND btrim(COALESCE(d.vehicle_type, '')) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM job_assignments ja
             WHERE ja.job_id = $2
               AND ja.driver_id = d.id
               AND ja.status = 'CANCELLED'
          )`,
      [job.organization_id, job.id]
    )).rows;
    if (candidates.length === 0) return { offered: 0, matched: 0, candidates: 0, skipped: 'NO_CANDIDATES' };

    const matches = await matchDriversForJob({ job, items, drivers: candidates });

    const invitedNames = [];
    for (const match of matches) {
      const driver = candidates.find((c) => c.id === match.driver_id);
      if (!driver) continue;
      try {
        const already = await pool.query(
          `SELECT 1 FROM job_requests WHERE job_id = $1 AND driver_id = $2 AND status = 'REQUESTED' LIMIT 1`,
          [job.id, driver.id]
        );
        if (already.rows.length > 0) continue;
        await bot.sendJobApplyInvite({ job, driver, match });
        invitedNames.push(`${driver.name} (${driver.vehicle_type}${match.fit === 'tight' ? ', tight fit' : ''})`);
      } catch (err) {
        console.error(`Invite to ${driver.name} for ${job.job_number} failed:`, err.message);
      }
    }

    if (invitedNames.length > 0) {
      await workflow.notifyManagers(pool, {
        organizationId: job.organization_id,
        jobId: job.id,
        type: 'JOB_OFFERS_SENT',
        title: `${job.job_number} sent to ${invitedNames.length} matched driver${invitedNames.length === 1 ? '' : 's'}`,
        body: `Vehicle match on publish: ${invitedNames.join(', ')}. They were invited to apply; approve from the Requests queue.`,
        severity: 'INFO',
      });
    }

    console.log(`Job invites: ${job.job_number} matched ${matches.length}/${candidates.length} available drivers, invited ${invitedNames.length}`);
    return { offered: invitedNames.length, matched: matches.length, candidates: candidates.length };
  } catch (err) {
    console.error(`offerPublishedJob(${jobId}) failed:`, err.message);
    return { offered: 0, matched: 0, candidates: 0, skipped: 'ERROR' };
  }
}

module.exports = { offerPublishedJob };
