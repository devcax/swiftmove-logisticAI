const { pool } = require('../db');
const sm = require('./jobStateMachine');
const { matchesExpectedCode } = require('../ai/documentCode');
const { formatWhen } = require('../time');

const DEMO_MANAGER_ID = '00000000-0000-0000-0000-000000000010';


const { MILESTONE_RANK, MILESTONE_EVENTS } = sm;

const INCIDENT_TYPES = ['ACCIDENT', 'BREAKDOWN', 'DAMAGE', 'SHORTAGE', 'REFUSAL', 'OTHER'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

class WorkflowError extends Error {
  constructor(message, code = 'INVALID_TRANSITION') {
    super(message);
    this.code = code;
  }
}

const START_WINDOW_MS = 24 * 60 * 60 * 1000;

function fmtWhen(value) {
  return formatWhen(value, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function stageDelay(job, stage) {
  const scheduledAt = stage === 'PICKUP' ? job.pickup_at : job.delivery_at;
  const actualAt = stage === 'PICKUP' ? job.pickup_actual_at : job.delivery_actual_at;
  const reason = stage === 'PICKUP' ? job.pickup_delay_reason : job.delivery_delay_reason;
  const late = Boolean(
    scheduledAt && actualAt && new Date(actualAt).getTime() > new Date(scheduledAt).getTime()
  );
  const minutesLate = late ? Math.round((new Date(actualAt) - new Date(scheduledAt)) / 60000) : 0;
  return {
    late, scheduledAt, actualAt, minutesLate,
    reasonRecorded: Boolean(reason),
    reason: reason ?? null,
  };
}


async function audit(client, { organizationId, actorType, actorUserId = null, actorDriverId = null, action, entityType, entityId, before = null, after = null }) {
  await client.query(
    `INSERT INTO audit_logs (organization_id, actor_type, actor_user_id, actor_driver_id, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [organizationId, actorType, actorUserId, actorDriverId, action, entityType, entityId,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

async function recordEvent(client, { jobId, assignmentId = null, messageId = null, eventType, status = 'APPLIED', data = {}, confidence = null }) {
  const r = await client.query(
    `INSERT INTO workflow_events (job_id, assignment_id, source_message_id, event_type, event_status, event_data, confidence_score, applied_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [jobId, assignmentId, messageId, eventType, status, JSON.stringify(data), confidence,
     status === 'APPLIED' ? new Date() : null]
  );
  return r.rows[0].id;
}

async function notifyManagers(client, { organizationId, jobId = null, incidentId = null, type, title, body, severity = 'INFO' }) {
  const managers = await client.query(
    `SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
     WHERE u.organization_id = $1 AND u.status = 'ACTIVE' AND r.code IN ('MANAGER', 'ADMIN')`,
    [organizationId]
  );
  for (const m of managers.rows) {
    await client.query(
      `INSERT INTO notifications (organization_id, job_id, incident_id, recipient_user_id, notification_type, title, body, severity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [organizationId, jobId, incidentId, m.id, type, title, body, severity]
    );
  }
}

async function setJobStatus(client, job, newStatus, actor) {
  await client.query(`UPDATE jobs SET current_status = $2 WHERE id = $1`, [job.id, newStatus]);
  await audit(client, {
    organizationId: job.organization_id,
    ...actor,
    action: 'JOB_STATUS_CHANGED',
    entityType: 'JOB',
    entityId: job.id,
    before: { status: job.current_status },
    after: { status: newStatus },
  });
  job.current_status = newStatus;
}

async function currentMilestoneRank(client, job) {
  if (MILESTONE_RANK[job.current_status] != null) return MILESTONE_RANK[job.current_status];

  const stageRank = sm.rankOf(job.current_status);
  if (stageRank != null && stageRank >= MILESTONE_RANK.DELIVERED) return MILESTONE_RANK.DELIVERED;

  if (!sm.isSideStatus(job.current_status)) return 0;

  const r = await client.query(
    `SELECT event_type FROM workflow_events
      WHERE job_id = $1 AND event_status = 'APPLIED' AND event_type = ANY($2)`,
    [job.id, MILESTONE_EVENTS]
  );
  const best = r.rows.reduce((max, row) => Math.max(max, MILESTONE_RANK[row.event_type] ?? 0), 0);
  return Math.max(best, MILESTONE_RANK.IN_PROGRESS);
}

async function protectionFloorRank(client, job) {
  const applied = await client.query(
    `SELECT event_type FROM workflow_events
      WHERE job_id = $1 AND event_status = 'APPLIED'
        AND event_type = ANY($2)`,
    [job.id, sm.PROTECTED_MILESTONES]
  );
  let floor = -1;
  for (const row of applied.rows) {
    floor = Math.max(floor, sm.STAGE_RANK[row.event_type] ?? -1);
  }
  const assigned = await client.query(
    `SELECT 1, started_at FROM job_assignments
      WHERE job_id = $1 AND status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW', 'COMPLETED')
      LIMIT 1`,
    [job.id]
  );
  if (assigned.rows.length > 0) {
    floor = Math.max(floor, sm.STAGE_RANK.ASSIGNED);
    if (assigned.rows[0].started_at) floor = Math.max(floor, sm.STAGE_RANK.IN_PROGRESS);
  }

  if (job.pickup_verified_at) floor = Math.max(floor, sm.STAGE_RANK.LOADED);
  if (job.delivery_verified_at) floor = Math.max(floor, sm.STAGE_RANK.DELIVERED);

  return floor;
}

async function offerJobToDriver(job, driver, { matchFit = null, matchReason = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [job.id])).rows[0];
    if (!locked) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (!['PUBLISHED', 'DRIVER_REQUESTED'].includes(locked.current_status)) {
      throw new WorkflowError(`${locked.job_number} is no longer open for offers`, 'JOB_NOT_OPEN');
    }

    const existing = await client.query(
      `SELECT id FROM job_assignments
        WHERE job_id = $1 AND driver_id = $2 AND status = 'PENDING_DRIVER_ACCEPTANCE'`,
      [locked.id, driver.id]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { job: locked, alreadyOffered: true };
    }

    await client.query(
      `UPDATE job_assignments SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'Superseded by a new job offer'
        WHERE driver_id = $1 AND status = 'PENDING_DRIVER_ACCEPTANCE'`,
      [driver.id]
    );

    const inserted = await client.query(
      `INSERT INTO job_assignments (job_id, driver_id, status, assigned_by_user_id)
       VALUES ($1, $2, 'PENDING_DRIVER_ACCEPTANCE', $3)
       RETURNING id`,
      [locked.id, driver.id, DEMO_MANAGER_ID]
    );
    const assignmentId = inserted.rows[0].id;

    await recordEvent(client, {
      jobId: locked.id, assignmentId,
      eventType: 'JOB_OFFERED',
      data: { driver_id: driver.id, driver: driver.name, match_fit: matchFit, match_reason: matchReason },
    });
    await audit(client, {
      organizationId: locked.organization_id,
      actorType: 'SYSTEM',
      action: 'JOB_OFFERED', entityType: 'JOB', entityId: locked.id,
      after: { driver_id: driver.id, match_fit: matchFit, match_reason: matchReason },
    });
    await client.query('COMMIT');
    return { job: locked, assignmentId, alreadyOffered: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}


async function executeTransition({
  client, job, assignment = null, eventType, data = {},
  source = 'CHAT', actor, messageId = null, confidence = null, verification = null,
}) {
  const currentRank = await currentMilestoneRank(client, job);
  const floor = await protectionFloorRank(client, job);

  const plan = sm.planTransition({
    currentStatus: job.current_status,
    currentRank: Math.max(currentRank, 0),
    target: eventType,
    source,
  });

  if (plan.kind === 'NOOP') {
    return { applied: [], inferred: [], newStatus: job.current_status, kind: 'NOOP', noop: true };
  }

  if (!plan.allowed) {
    throw new WorkflowError(plan.reason, plan.code ?? 'INVALID_TRANSITION');
  }

  const targetRank = MILESTONE_RANK[eventType];
  if (source === 'CHAT' && targetRank < floor) {
    const milestone = sm.floorMilestone(floor);
    throw new WorkflowError(
      `This job is already confirmed as ${sm.label(milestone)}, so it cannot go back to ${sm.label(eventType)}.`,
      'PROTECTED_MILESTONE'
    );
  }

  const applied = [];

  for (const inferredState of plan.inferred) {
    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment?.id ?? null, messageId,
      eventType: inferredState, confidence,
      data: { inferred: true, inferred_by: 'SYSTEM', reason: `implied by ${eventType}` },
    });
    applied.push(inferredState);
  }

  let newStatus = eventType;
  if (eventType === 'DELIVERED' && (data.refused_quantity || data.damaged_quantity || data.shortage_quantity)) {
    newStatus = 'DELIVERED_WITH_EXCEPTION';
  }

  const eventData = { ...data };
  if (plan.kind === 'BACKWARD') eventData.correction = true;
  if (verification) eventData.verification = verification;

  const eventId = await recordEvent(client, {
    jobId: job.id, assignmentId: assignment?.id ?? null, messageId,
    eventType, data: eventData, confidence,
  });
  applied.push(eventType);

  await setJobStatus(client, job, newStatus, actor);

  if (applied.includes('ARRIVED_AT_PICKUP')) {
    await client.query(
      'UPDATE jobs SET pickup_actual_at = COALESCE(pickup_actual_at, now()) WHERE id = $1',
      [job.id]
    );
  }

  return { applied, inferred: plan.inferred, newStatus, kind: plan.kind, noop: false, eventId };
}

async function applyMilestone(driver, eventType, data, messageId, confidence, { source = 'CHAT' } = {}) {
  if (!MILESTONE_EVENTS.includes(eventType)) {
    throw new WorkflowError(`${eventType} is not a milestone event`, 'NOT_A_MILESTONE');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || !['ASSIGNED', 'ACTIVE'].includes(assignment.status)) {
      throw new WorkflowError('You do not have a job in progress right now.', 'BAD_STATE');
    }
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];
    if (job.current_status === 'CANCELLATION_REVIEW') {
      throw new WorkflowError(
        'This job is waiting for the manager to review your cancellation request, so progress updates are paused.',
        'JOB_FROZEN'
      );
    }

    const result = await executeTransition({
      client, job, assignment, eventType, data, source, messageId, confidence,
      actor: { actorType: 'DRIVER', actorDriverId: driver.id },
    });
    await client.query('COMMIT');
    return { job, assignment, ...result };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}


async function reportIncident(driver, { incidentType, severity, description, data = {}, messageId, confidence, eventType = 'INCIDENT_REPORTED', imageUrl = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment) throw new WorkflowError('No active job for this report', 'BAD_STATE');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];

    const type = INCIDENT_TYPES.includes(incidentType) ? incidentType : 'OTHER';
    const sev = type === 'ACCIDENT' ? 'CRITICAL' : SEVERITIES.includes(severity) ? severity : 'HIGH';

    const existing = await client.query(
      `SELECT id, incident_type, severity
         FROM incidents
        WHERE job_id = $1
          AND incident_type = $2
          AND status IN ('OPEN', 'UNDER_REVIEW')
        ORDER BY created_at DESC
        LIMIT 1`,
      [job.id, type],
    );

    if (existing.rows[0]) {
      await client.query('COMMIT');
      return {
        job,
        assignment,
        incidentId: existing.rows[0].id,
        incidentType: existing.rows[0].incident_type,
        severity: existing.rows[0].severity,
        alreadyReported: true,
      };
    }

    const incident = await client.query(
      `INSERT INTO incidents (job_id, assignment_id, reported_by_driver_id, source_message_id, incident_type, severity, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [job.id, assignment.id, driver.id, messageId, type, sev, description]
    );
    const incidentId = incident.rows[0].id;

    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment.id, messageId,
      eventType, status: 'REVIEW_REQUIRED', data: { ...data, incident_id: incidentId, incident_type: type, severity: sev }, confidence,
    });

    if (eventType === 'INCIDENT_REPORTED') {
      await setJobStatus(client, job, 'INCIDENT_OPEN', { actorType: 'DRIVER', actorDriverId: driver.id });
    } else if (eventType === 'FAILED_DELIVERY') {
      await setJobStatus(client, job, 'FAILED_DELIVERY', { actorType: 'DRIVER', actorDriverId: driver.id });
    }

    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      incidentId,
      type: 'INCIDENT',
      title: `${type} on ${job.job_number}`,
      body: `${driver.name}: ${description}${imageUrl ? `\nPhoto: ${imageUrl}` : ''}`,
      severity: sev === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'DRIVER', actorDriverId: driver.id,
      action: 'INCIDENT_REPORTED', entityType: 'INCIDENT', entityId: incidentId,
      after: { type, severity: sev },
    });
    await client.query('COMMIT');
    return { job, assignment, incidentId, incidentType: type, severity: sev };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function verifyDocument(driver, { jobId, stage, extraction, attachmentId = null, messageId = null, imageUrl = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (!['PICKUP', 'DELIVERY'].includes(stage)) {
      throw new WorkflowError('Document stage must be pickup or delivery', 'BAD_DOCUMENT_STAGE');
    }
    if (stage === 'DELIVERY' && !job.pickup_verified_at) {
      throw new WorkflowError('The pickup document must be verified before the delivery document.', 'PICKUP_REQUIRED_FIRST');
    }

    const verifiedColumn = stage === 'PICKUP' ? 'pickup_verified_at' : 'delivery_verified_at';
    const proofColumn = stage === 'PICKUP' ? 'pickup_proof_attachment_id' : 'delivery_proof_attachment_id';
    const expectedCode = stage === 'PICKUP' ? job.pickup_code : job.delivery_code;

    const { matched, reason } = matchesExpectedCode({
      extraction,
      expectedCode,
      jobNumber: job.job_number,
    });

    if (!matched) {
      await recordEvent(client, {
        jobId: job.id, messageId,
        eventType: 'DOCUMENT_VERIFIED', status: 'REJECTED',
        data: {
          stage, method: 'VISION', attachment_id: attachmentId,
          detected_job_number: extraction.jobNumber ?? null,
          reason,
        },
      });
      await notifyManagers(client, {
        organizationId: job.organization_id,
        jobId: job.id,
        type: 'SECURITY_ALERT',
        title: `Unverified ${stage.toLowerCase()} paper on ${job.job_number}`,
        body: `${driver.name} sent a photo whose code did NOT match the ${stage.toLowerCase()} security code (${reason}).${imageUrl ? ` Photo: ${imageUrl}` : ''}`,
        severity: 'WARNING',
      });
      await client.query('COMMIT');
      return { verified: false, reason, job, applied: [], inferred: [], newStatus: job.current_status, alreadyVerified: false };
    }

    const alreadyVerified = Boolean(job[verifiedColumn]);
    if (!alreadyVerified) {
      await client.query(
        `UPDATE jobs SET ${verifiedColumn} = now(), ${proofColumn} = COALESCE($2, ${proofColumn}) WHERE id = $1`,
        [job.id, attachmentId]
      );
      job[verifiedColumn] = new Date();
      await recordEvent(client, {
        jobId: job.id, messageId,
        eventType: 'DOCUMENT_VERIFIED',
        data: { stage, method: 'CODE_MATCH', attachment_id: attachmentId },
      });
    }

    const actualColumn = stage === 'PICKUP' ? 'pickup_actual_at' : 'delivery_actual_at';
    if (!job[actualColumn]) {
      await client.query(`UPDATE jobs SET ${actualColumn} = now() WHERE id = $1`, [job.id]);
      job[actualColumn] = new Date();
    }

    const assignment = await getDriverAssignment(client, driver.id);
    let result = { applied: [], inferred: [], newStatus: job.current_status, noop: true };
    let needsStartConfirmation = false;
    let needsDelayReason = null;
    if (assignment && assignment.job_id === job.id) {
      if (assignment.status !== 'ACTIVE') {
        needsStartConfirmation = true;
      } else {
        const delay = stageDelay(job, stage);
        if (delay.late && !delay.reasonRecorded) {
          needsDelayReason = { stage, ...delay };
        } else {
          result = await executeTransition({
            client, job, assignment,
            eventType: stage === 'PICKUP' ? 'LOADED' : 'DELIVERED',
            source: 'DOCUMENT',
            messageId,
            confidence: 1,
            verification: { stage, method: 'CODE_MATCH', attachment_id: attachmentId },
            actor: { actorType: 'SYSTEM' },
          });
        }
      }
    }

    await client.query('COMMIT');

    if (!alreadyVerified) {
      const advanced = (result.applied ?? []).length > 0 && !result.noop;
      const heldReason = needsStartConfirmation
        ? ' The job has not been confirmed as started yet, so the advance is waiting on the driver.'
        : needsDelayReason
          ? ` The ${stage.toLowerCase()} was late, so the advance is waiting on the driver's delay reason.`
          : '';
      await notifyManagers(pool, {
        organizationId: job.organization_id,
        jobId: job.id,
        type: 'DOCUMENT_VERIFIED',
        title: `${stage} document verified on ${job.job_number}`,
        body: `${driver.name} sent a ${stage.toLowerCase()} paper that matched the security code.${advanced ? ` The job advanced to ${sm.label(result.newStatus)} automatically.` : heldReason}${imageUrl ? ` Photo: ${imageUrl}` : ''}`,
        severity: 'INFO',
      });
    }

    return { verified: true, reason: null, job, alreadyVerified, needsStartConfirmation, needsDelayReason, ...result };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordStageDelay(driver, stage, reason, messageId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || !['ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW'].includes(assignment.status)) {
      throw new WorkflowError('You do not have a job in progress right now.', 'BAD_STATE');
    }
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];
    const delay = stageDelay(job, stage);
    if (!delay.late) {
      throw new WorkflowError(`There is no late ${stage.toLowerCase()} on record for this job.`, 'NO_DELAY');
    }
    if (delay.reasonRecorded) {
      await client.query('COMMIT');
      return { job, alreadyRecorded: true, ...delay };
    }

    const column = stage === 'PICKUP' ? 'pickup_delay_reason' : 'delivery_delay_reason';
    await client.query(`UPDATE jobs SET ${column} = $2 WHERE id = $1`, [job.id, reason]);
    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment.id, messageId,
      eventType: 'DELAY_REPORTED',
      data: {
        stage,
        reason,
        scheduled_at: delay.scheduledAt,
        actual_at: delay.actualAt,
        minutes_late: delay.minutesLate,
        source: 'STAGE_GATE',
      },
      confidence: 1,
    });
    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      type: 'DELAY',
      title: `Late ${stage.toLowerCase()} on ${job.job_number}`,
      body: `${driver.name} confirmed the ${stage.toLowerCase()} about ${delay.minutesLate} min late (scheduled ${fmtWhen(delay.scheduledAt)}). Reason: ${reason}`,
      severity: delay.minutesLate >= 60 ? 'HIGH' : 'WARNING',
    });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'DRIVER', actorDriverId: driver.id,
      action: `${stage}_DELAY_REASON_RECORDED`, entityType: 'JOB', entityId: job.id,
      after: { reason, minutes_late: delay.minutesLate },
    });
    await client.query('COMMIT');
    return { job, alreadyRecorded: false, ...delay };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function applyPendingVerificationsForJob(jobId, messageId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    const assignment = (await client.query(
      `SELECT * FROM job_assignments
        WHERE job_id = $1 AND status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
        ORDER BY assigned_at DESC LIMIT 1`,
      [jobId]
    )).rows[0] ?? null;

    const advances = [];
    let needsStartConfirmation = false;
    let needsDelayReason = null;

    for (const stage of ['PICKUP', 'DELIVERY']) {
      const verifiedAt = stage === 'PICKUP' ? job.pickup_verified_at : job.delivery_verified_at;
      if (!verifiedAt) continue;
      const target = stage === 'PICKUP' ? 'LOADED' : 'DELIVERED';
      const rank = await currentMilestoneRank(client, job);
      if (rank >= MILESTONE_RANK[target]) continue;

      if (!assignment || assignment.status !== 'ACTIVE') {
        needsStartConfirmation = true;
        break;
      }
      const delay = stageDelay(job, stage);
      if (delay.late && !delay.reasonRecorded) {
        needsDelayReason = { stage, ...delay };
        break;
      }

      const method = (await client.query(
        `SELECT event_data ->> 'method' AS m FROM workflow_events
          WHERE job_id = $1 AND event_type = 'DOCUMENT_VERIFIED' AND event_status = 'APPLIED'
            AND event_data ->> 'stage' = $2
          ORDER BY created_at DESC LIMIT 1`,
        [jobId, stage]
      )).rows[0]?.m ?? 'CODE_MATCH';

      const result = await executeTransition({
        client, job, assignment,
        eventType: target,
        source: 'DOCUMENT',
        messageId,
        confidence: 1,
        verification: { stage, method },
        actor: { actorType: 'SYSTEM' },
      });
      advances.push({ stage, ...result });
      if (result.noop) break;
    }

    await client.query('COMMIT');
    return { job, assignment, advances, needsStartConfirmation, needsDelayReason };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function releaseDriver(jobId, { reason = null, managerId = DEMO_MANAGER_ID } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');

    const aR = await client.query(
      `SELECT * FROM job_assignments
        WHERE job_id = $1 AND status IN ('PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
        LIMIT 1`,
      [jobId]
    );
    if (aR.rows.length === 0) {
      throw new WorkflowError('Job has no live driver assignment', 'BAD_STATE');
    }
    const assignment = aR.rows[0];

    await client.query(
      `UPDATE job_assignments
          SET status = 'CANCELLED', cancelled_at = now(),
              cancellation_reason = $2
        WHERE id = $1`,
      [assignment.id, reason ?? 'Released by manager']
    );
    await client.query('UPDATE drivers SET active_job_id = NULL WHERE id = $1', [assignment.driver_id]);

    const others = await client.query(
      `SELECT 1 FROM job_requests WHERE job_id = $1 AND status = 'REQUESTED' LIMIT 1`,
      [jobId]
    );
    await setJobStatus(client, job, others.rows.length > 0 ? 'DRIVER_REQUESTED' : 'PUBLISHED',
      { actorType: 'MANAGER', actorUserId: managerId });

    await recordEvent(client, {
      jobId, assignmentId: assignment.id, eventType: 'DRIVER_RELEASED',
      data: { reason: reason ?? 'Released by manager', driverId: assignment.driver_id },
    });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'DRIVER_RELEASED', entityType: 'JOB', entityId: job.id,
    });
    await client.query('COMMIT');

    const driver = (await pool.query(
      `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
        LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
       WHERE d.id = $1`,
      [assignment.driver_id]
    )).rows[0];
    return { job, driver, assignment };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resetJob(jobId, {
  managerId = DEMO_MANAGER_ID,
  pickupCode = null,
  deliveryCode = null,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (job.current_status === 'DRAFT') {
      throw new WorkflowError('A draft job has nothing to reset', 'BAD_STATE');
    }
    if (job.current_status === 'COMPLETED') {
      throw new WorkflowError('A completed job is closed and cannot be reset.', 'JOB_FROZEN');
    }

    await client.query(
      `UPDATE drivers SET active_job_id = NULL
        WHERE active_job_id = $1
           OR id IN (SELECT driver_id FROM job_assignments WHERE job_id = $1)`,
      [jobId]
    );

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
    await client.query(
      `UPDATE job_summaries SET summary_text = '', driver_id = NULL, message_count = 0, last_message_id = NULL
        WHERE job_id = $1`,
      [jobId]
    );

    const status = 'PUBLISHED';
    await client.query(
      `UPDATE jobs
          SET current_status = 'PUBLISHED',
              published_at = now(),
              completed_at = NULL,
              completed_by_user_id = NULL,
              pickup_actual_at = NULL,
              pickup_verified_at = NULL,
              pickup_delay_reason = NULL,
              pickup_proof_attachment_id = NULL,
              delivery_actual_at = NULL,
              delivery_verified_at = NULL,
              delivery_delay_reason = NULL,
              delivery_proof_attachment_id = NULL,
              pickup_code = $2,
              delivery_code = $3
        WHERE id = $1`,
      [jobId, pickupCode ?? job.pickup_code, deliveryCode ?? job.delivery_code]
    );

    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'JOB_RESET', entityType: 'JOB', entityId: job.id,
      before: { status: job.current_status },
      after: { status },
    });
    await client.query('COMMIT');
    job.current_status = status;
    return { job };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveIncident(incidentId, action, notes, managerId = DEMO_MANAGER_ID) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const incR = await client.query(
      `SELECT i.*, j.organization_id, j.current_status AS job_status, j.job_number
         FROM incidents i JOIN jobs j ON j.id = i.job_id
        WHERE i.id = $1 FOR UPDATE`,
      [incidentId]
    );
    if (incR.rows.length === 0) throw new WorkflowError('Incident not found', 'NOT_FOUND');
    const incident = incR.rows[0];

    if (action === 'resolve') {
      await client.query(
        `UPDATE incidents
            SET status = 'RESOLVED', manager_notes = COALESCE($2, manager_notes),
                resolved_at = now(), resolved_by_user_id = $3
          WHERE id = $1`,
        [incidentId, notes, managerId]
      );
      if (incident.job_status === 'INCIDENT_OPEN') {
        const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [incident.job_id])).rows[0];
        const rank = await currentMilestoneRank(client, job);
        const restored = Object.keys(MILESTONE_RANK).find((k) => MILESTONE_RANK[k] === rank) ?? 'IN_PROGRESS';
        await setJobStatus(client, job, restored, { actorType: 'MANAGER', actorUserId: managerId });
      }
    } else if (action === 'under_review' || action === 'keep_open') {
      await client.query(
        `UPDATE incidents SET status = $2, manager_notes = COALESCE($3, manager_notes) WHERE id = $1`,
        [incidentId, action === 'under_review' ? 'UNDER_REVIEW' : 'OPEN', notes]
      );
    } else {
      throw new WorkflowError(`Unknown incident action: ${action}`, 'BAD_ACTION');
    }

    await audit(client, {
      organizationId: incident.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: `INCIDENT_${action.toUpperCase()}`, entityType: 'INCIDENT', entityId: incidentId,
      after: { notes: notes ?? null },
    });
    await client.query('COMMIT');
    return { incident };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}


async function endJob(driver, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || assignment.status !== 'ACTIVE') {
      throw new WorkflowError('You can only finish a job that has been started', 'BAD_STATE');
    }
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];

    if (['DRIVER_SUBMITTED_COMPLETION', 'MANAGER_REVIEW', 'COMPLETED'].includes(job.current_status)) {
      await client.query('COMMIT');
      return { job, assignment, alreadyRequested: true };
    }

    const rank = await currentMilestoneRank(client, job);
    if (rank < MILESTONE_RANK.IN_PROGRESS) {
      throw new WorkflowError('This job has not started yet', 'BAD_STATE');
    }
    if (rank < MILESTONE_RANK.DELIVERED) {
      throw new WorkflowError(
        'The delivery is not confirmed yet. Send a photo of the delivery document so the delivery code can be verified, then I can send this job for closure.',
        'NOT_DELIVERED'
      );
    }

    await client.query(
      `UPDATE job_assignments SET completion_submitted_at = COALESCE(completion_submitted_at, now()) WHERE id = $1`,
      [assignment.id]
    );
    await setJobStatus(client, job, 'DRIVER_SUBMITTED_COMPLETION', { actorType: 'DRIVER', actorDriverId: driver.id });
    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment.id, messageId,
      eventType: 'END_JOB', data: { source: 'DRIVER' }, confidence,
    });
    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      type: 'COMPLETION_REVIEW',
      title: `${job.job_number} ready for review`,
      body: `${driver.name} submitted trip completion. Review the timeline and mark as done.`,
      severity: 'INFO',
    });
    await client.query('COMMIT');
    return { job, assignment };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function verifyStageByManager(jobId, stage, managerId = DEMO_MANAGER_ID) {
  if (!['PICKUP', 'DELIVERY'].includes(stage)) {
    throw new WorkflowError('Document stage must be pickup or delivery', 'BAD_DOCUMENT_STAGE');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (sm.isFrozen(job.current_status)) {
      throw new WorkflowError('This job is closed, so its documents cannot be verified.', 'JOB_FROZEN');
    }
    if (stage === 'DELIVERY' && !job.pickup_verified_at) {
      throw new WorkflowError('Verify the pickup code before verifying the delivery code.', 'PICKUP_REQUIRED_FIRST');
    }

    const assignment = (await client.query(
      `SELECT * FROM job_assignments
        WHERE job_id = $1
          AND status IN ('PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
        ORDER BY assigned_at DESC
        LIMIT 1`,
      [jobId],
    )).rows[0] ?? null;
    if (!assignment || assignment.status !== 'ACTIVE') {
      throw new WorkflowError('The driver must start this job before its documents can be verified.', 'BAD_STATE');
    }

    const verifiedColumn = stage === 'PICKUP' ? 'pickup_verified_at' : 'delivery_verified_at';
    const actualColumn = stage === 'PICKUP' ? 'pickup_actual_at' : 'delivery_actual_at';
    const alreadyVerified = Boolean(job[verifiedColumn]);

    if (!alreadyVerified) {
      await client.query(
        `UPDATE jobs
            SET ${verifiedColumn} = now(),
                ${actualColumn} = COALESCE(${actualColumn}, now())
          WHERE id = $1`,
        [job.id],
      );
      job[verifiedColumn] = new Date();
      job[actualColumn] = job[actualColumn] ?? new Date();
      await recordEvent(client, {
        jobId: job.id,
        assignmentId: assignment?.id ?? null,
        eventType: 'DOCUMENT_VERIFIED',
        data: { stage, method: 'MANAGER_MANUAL' },
      });
    }

    const target = stage === 'PICKUP' ? 'LOADED' : 'DELIVERED';
    const currentRank = await currentMilestoneRank(client, job);
    const result = alreadyVerified || currentRank >= MILESTONE_RANK[target]
      ? { applied: [], inferred: [], newStatus: job.current_status, kind: 'NOOP', noop: true }
      : await executeTransition({
        client,
        job,
        assignment,
        eventType: target,
        source: 'MANAGER',
        verification: { stage, method: 'MANAGER_MANUAL' },
        actor: { actorType: 'MANAGER', actorUserId: managerId },
      });

    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER',
      actorUserId: managerId,
      action: `${stage}_DOCUMENT_VERIFIED`,
      entityType: 'JOB',
      entityId: job.id,
      after: { stage, status: result.newStatus, method: 'MANAGER_MANUAL' },
    });
    await client.query('COMMIT');

    const driver = assignment
      ? (await pool.query(
        `SELECT d.id, d.name, wa.phone_e164
           FROM drivers d
           LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
          WHERE d.id = $1`,
        [assignment.driver_id],
      )).rows[0] ?? null
      : null;

    return { job, driver, assignment, alreadyVerified, ...result };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const AUTO_CLOSURE_DELAY_MINUTES = Number(process.env.AUTO_CLOSURE_DELAY_MINUTES ?? 2);

async function findJobsDueForAutoClosure(minutes = AUTO_CLOSURE_DELAY_MINUTES) {
  const r = await pool.query(
    `SELECT j.id
       FROM jobs j
      WHERE j.current_status IN ('DELIVERED', 'DELIVERED_WITH_EXCEPTION')
        AND EXISTS (
          SELECT 1 FROM workflow_events we
           WHERE we.job_id = j.id AND we.event_type = 'DELIVERED'
             AND we.event_status = 'APPLIED'
             AND we.applied_at <= now() - ($1 * interval '1 minute')
        )
        AND EXISTS (
          SELECT 1 FROM job_assignments ja
           WHERE ja.job_id = j.id AND ja.status = 'ACTIVE'
        )
      ORDER BY j.id
      LIMIT 25`,
    [minutes]
  );
  return r.rows.map((row) => row.id);
}

async function requestClosureAuto(jobId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');

    if (!['DELIVERED', 'DELIVERED_WITH_EXCEPTION'].includes(job.current_status)) {
      await client.query('COMMIT');
      return { job, driver: null, alreadyRequested: true };
    }
    const aR = await client.query(
      `SELECT * FROM job_assignments WHERE job_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [jobId]
    );
    const assignment = aR.rows[0] ?? null;
    if (!assignment) {
      await client.query('COMMIT');
      return { job, driver: null, alreadyRequested: true };
    }

    await client.query(
      `UPDATE job_assignments SET completion_submitted_at = COALESCE(completion_submitted_at, now()) WHERE id = $1`,
      [assignment.id]
    );
    await setJobStatus(client, job, 'DRIVER_SUBMITTED_COMPLETION', { actorType: 'SYSTEM' });
    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment.id,
      eventType: 'END_JOB',
      data: { source: 'AUTO', reason: 'Delivered with no driver closure request inside the auto-closure window' },
    });
    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      type: 'COMPLETION_REVIEW',
      title: `${job.job_number} sent for closure automatically`,
      body: 'The delivery was confirmed and the driver did not request closure, so the job was sent for closure approval automatically.',
      severity: 'INFO',
    });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'SYSTEM',
      action: 'CLOSURE_REQUESTED', entityType: 'JOB', entityId: job.id,
      after: { source: 'AUTO' },
    });
    await client.query('COMMIT');

    const driver = (await pool.query(
      `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
        LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
       WHERE d.id = $1`,
      [assignment.driver_id]
    )).rows[0];
    return { job, driver, assignment, alreadyRequested: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function attachDocuments(driver, { attachmentIds, documentType = 'OTHER', caption = null, jobId = null, messageId, confidence = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let assignment = await getDriverAssignment(client, driver.id);
    let job;
    if (jobId) {
      job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
      if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
      const owned = assignment && assignment.job_id === job.id;
      if (!owned) {
        const recent = await client.query(
          `SELECT 1 FROM job_assignments WHERE job_id = $1 AND driver_id = $2 LIMIT 1`,
          [job.id, driver.id]
        );
        if (recent.rows.length === 0) {
          throw new WorkflowError('That job is not assigned to you', 'NOT_YOUR_JOB');
        }
      }
    } else {
      if (!assignment) throw new WorkflowError('You have no active job to attach documents to', 'NO_ACTIVE_JOB');
      job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];
    }

    await recordEvent(client, {
      jobId: job.id,
      assignmentId: assignment?.job_id === job.id ? assignment.id : null,
      messageId,
      eventType: 'DOCUMENT_RECEIVED',
      confidence,
      data: { attachment_ids: attachmentIds, document_type: documentType, caption },
    });
    await client.query('COMMIT');
    return { job };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function hasPodDocument(jobId) {
  const result = await pool.query(
    `SELECT 1 FROM workflow_events
      WHERE job_id = $1 AND event_type = 'DOCUMENT_RECEIVED'
        AND event_data ->> 'document_type' = 'POD'
      LIMIT 1`,
    [jobId]
  );
  return result.rows.length > 0;
}

async function describeProgress(driver) {
  const assignment = await getDriverAssignment(pool, driver.id);
  if (!assignment) {
    const recent = await pool.query(
      `SELECT j.* FROM job_assignments ja JOIN jobs j ON j.id = ja.job_id
        WHERE ja.driver_id = $1
        ORDER BY ja.assigned_at DESC LIMIT 1`,
      [driver.id]
    );
    const job = recent.rows[0];
    if (!job) return null;
    return {
      job,
      stage: job.current_status,
      label: sm.label(job.current_status),
      nextStep: sm.nextStepHint(job.current_status),
      verifiedPickup: Boolean(job.pickup_verified_at),
      verifiedDelivery: Boolean(job.delivery_verified_at),
      pending: [],
      live: false,
    };
  }

  const job = (await pool.query('SELECT * FROM jobs WHERE id = $1', [assignment.job_id])).rows[0];
  return {
    job,
    assignment,
    stage: job.current_status,
    label: sm.label(job.current_status),
    nextStep: sm.nextStepHint(job.current_status),
    verifiedPickup: Boolean(job.pickup_verified_at),
    verifiedDelivery: Boolean(job.delivery_verified_at),
    pending: pendingRequirements(job, assignment),
    live: true,
  };
}

function pendingRequirements(job, assignment) {
  const pending = [];
  if (assignment && assignment.status === 'ASSIGNED') {
    if (job.pickup_at) {
      const earliest = new Date(new Date(job.pickup_at).getTime() - START_WINDOW_MS);
      if (Date.now() < earliest.getTime()) {
        pending.push({
          code: 'START_WINDOW',
          earliestStart: earliest,
          message: `it can be started from ${fmtWhen(earliest)} (24 hours before the scheduled pickup)`,
        });
      }
    }
    if (job.pickup_verified_at) {
      pending.push({
        code: 'START_CONFIRMATION',
        message: 'the pickup document is verified, but you still need to confirm that you have started the job',
      });
    }
  }
  const pickup = stageDelay(job, 'PICKUP');
  if (pickup.late && !pickup.reasonRecorded && job.pickup_verified_at) {
    pending.push({
      code: 'PICKUP_DELAY_REASON',
      message: 'the pickup was late and I still need your reason for the delay before the job can be marked as loaded',
    });
  }
  const delivery = stageDelay(job, 'DELIVERY');
  if (delivery.late && !delivery.reasonRecorded && job.delivery_verified_at) {
    pending.push({
      code: 'DELIVERY_DELAY_REASON',
      message: 'the delivery was late and I still need your reason for the delay before the job can be marked as delivered',
    });
  }
  return pending;
}

/** Recent jobs of a driver (for the "which job is this document for?" picker). */
async function listRecentJobsForDriver(driver, limit = 5) {
  const r = await pool.query(
    `SELECT j.id, j.job_number, j.current_status, j.cargo_description,
            pl.name AS pickup, dl.name AS delivery
       FROM job_assignments ja
       JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
       LEFT JOIN locations pl ON pl.id = ps.location_id
       LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
       LEFT JOIN locations dl ON dl.id = ds.location_id
      WHERE ja.driver_id = $1
      ORDER BY ja.assigned_at DESC
      LIMIT $2`,
    [driver.id, limit]
  );
  return r.rows;
}

async function getDriverAssignment(client, driverId) {
  const r = await client.query(
    `SELECT ja.*, j.job_number, j.current_status AS job_status, j.organization_id, j.cargo_description
       FROM job_assignments ja
       JOIN jobs j ON j.id = ja.job_id
      WHERE ja.driver_id = $1
        AND ja.status IN ('PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
      ORDER BY ja.assigned_at DESC
      LIMIT 1`,
    [driverId]
  );
  return r.rows[0] ?? null;
}

async function getJobByNumber(client, organizationId, jobRef) {
  if (!jobRef) return null;
  const cleaned = String(jobRef).toUpperCase().trim();
  const number = cleaned.startsWith('JOB-') ? cleaned : cleaned.replace(/^#?/, '');
  const r = await client.query(
    `SELECT * FROM jobs
      WHERE organization_id = $1
        AND (upper(job_number) = $2 OR upper(job_number) = $3)
      LIMIT 1`,
    [organizationId, number, number.startsWith('JOB-') ? number : `JOB-${number}`]
  );
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Request / assignment lifecycle (Phase 2)
// ---------------------------------------------------------------------------

/** Driver asks for available jobs â return requestable jobs. */

async function listAvailableJobs(driver) {
  const r = await pool.query(
    `SELECT j.id, j.job_number, j.cargo_description, j.pickup_at,
            pl.name AS pickup, dl.name AS delivery,
            ji.planned_quantity AS quantity, ji.unit
       FROM jobs j
       LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
       LEFT JOIN locations pl ON pl.id = ps.location_id
       LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
       LEFT JOIN locations dl ON dl.id = ds.location_id
       LEFT JOIN job_items ji ON ji.job_id = j.id
      WHERE j.organization_id = $1
        AND j.current_status IN ('PUBLISHED', 'DRIVER_REQUESTED')
        AND j.pickup_at >= now()
        AND j.pickup_at < now() + interval '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM job_requests jr
           WHERE jr.job_id = j.id AND jr.driver_id = $2 AND jr.status = 'REQUESTED'
        )
        AND NOT EXISTS (
          SELECT 1 FROM job_assignments ja
           WHERE ja.job_id = j.id AND ja.driver_id = $2 AND ja.status = 'CANCELLED'
        )
      ORDER BY j.pickup_at ASC
      LIMIT 10`,
    [driver.organization_id, driver.id]
  );
  return r.rows;
}

async function getPendingRequest(driver) {
  const r = await pool.query(
    `SELECT jr.id, jr.job_id, jr.requested_at, j.job_number
       FROM job_requests jr JOIN jobs j ON j.id = jr.job_id
      WHERE jr.driver_id = $1 AND jr.status = 'REQUESTED'
      ORDER BY jr.requested_at DESC LIMIT 1`,
    [driver.id]
  );
  return r.rows[0] ?? null;
}

/** Driver requests a job. Returns { job } â throws WorkflowError when blocked. */

async function requestJob(driver, job, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM drivers WHERE id = $1 FOR UPDATE', [driver.id]);

    const existingAssignment = await getDriverAssignment(client, driver.id);
    if (existingAssignment) {
      throw new WorkflowError(`Driver already tied to ${existingAssignment.job_number}`, 'DRIVER_BUSY');
    }
    if (!['PUBLISHED', 'DRIVER_REQUESTED'].includes(job.current_status)) {
      throw new WorkflowError(`${job.job_number} is not open for requests`, 'JOB_NOT_OPEN');
    }
    const pickupAt = new Date(job.pickup_at).getTime();
    if (!Number.isFinite(pickupAt) || pickupAt < Date.now() || pickupAt >= Date.now() + 24 * 60 * 60 * 1000) {
      throw new WorkflowError(`${job.job_number} is only available within 24 hours of pickup`, 'JOB_OUTSIDE_WINDOW');
    }
    const released = await client.query(
      `SELECT 1 FROM job_assignments
        WHERE job_id = $1 AND driver_id = $2 AND status = 'CANCELLED'
        LIMIT 1`,
      [job.id, driver.id]
    );
    if (released.rows.length > 0) {
      throw new WorkflowError(`You were released from ${job.job_number}, so it cannot be requested again`, 'DRIVER_RELEASED');
    }

    const inserted = await client.query(
      `INSERT INTO job_requests (job_id, driver_id, status)
       VALUES ($1, $2, 'REQUESTED')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [job.id, driver.id]
    );
    if (inserted.rows.length === 0) {
      throw new WorkflowError(`Driver already requested ${job.job_number}`, 'DUPLICATE_REQUEST');
    }

    if (job.current_status === 'PUBLISHED') {
      await setJobStatus(client, job, 'DRIVER_REQUESTED', { actorType: 'DRIVER', actorDriverId: driver.id });
    }
    await recordEvent(client, { jobId: job.id, messageId, eventType: 'REQUEST_JOB', data: { driver: driver.name }, confidence });
    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      type: 'JOB_REQUEST',
      title: `${driver.name} requested ${job.job_number}`,
      body: `${driver.name} asked for ${job.job_number} (${job.cargo_description}) via WhatsApp. Approve or reject in the request queue.`,
      severity: 'INFO',
    });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'DRIVER', actorDriverId: driver.id,
      action: 'JOB_REQUEST_CREATED', entityType: 'JOB', entityId: job.id,
      after: { request_id: inserted.rows[0].id },
    });
    await client.query('COMMIT');
    return { job };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Driver cancels their own pending request (pre-approval). */

async function cancelJobRequest(driver, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const req = await client.query(
      `UPDATE job_requests SET status = 'CANCELLED_BY_DRIVER', cancelled_at = now()
        WHERE driver_id = $1 AND status = 'REQUESTED'
        RETURNING id, job_id`,
      [driver.id]
    );
    if (req.rows.length === 0) throw new WorkflowError('No pending request to cancel', 'NO_PENDING_REQUEST');

    const job = (await client.query('SELECT * FROM jobs WHERE id = $1', [req.rows[0].job_id])).rows[0];
    const others = await client.query(
      `SELECT 1 FROM job_requests WHERE job_id = $1 AND status = 'REQUESTED' LIMIT 1`,
      [job.id]
    );
    if (others.rows.length === 0 && job.current_status === 'DRIVER_REQUESTED') {
      await setJobStatus(client, job, 'PUBLISHED', { actorType: 'DRIVER', actorDriverId: driver.id });
    }
    await recordEvent(client, { jobId: job.id, messageId, eventType: 'CANCEL_JOB_REQUEST', confidence });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'DRIVER', actorDriverId: driver.id,
      action: 'JOB_REQUEST_CANCELLED', entityType: 'JOB', entityId: job.id,
    });
    await client.query('COMMIT');
    return { job };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Manager approves a request â offer goes to the driver (bot sends buttons). */

async function approveRequest(requestId, managerId = DEMO_MANAGER_ID) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqR = await client.query(
      `SELECT jr.*, j.job_number, j.current_status AS job_status, j.organization_id, j.cargo_description
         FROM job_requests jr JOIN jobs j ON j.id = jr.job_id
        WHERE jr.id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqR.rows.length === 0) throw new WorkflowError('Request not found', 'NOT_FOUND');
    const req = reqR.rows[0];
    if (req.status !== 'REQUESTED') throw new WorkflowError(`Request is ${req.status}, cannot approve`, 'BAD_STATE');

    await client.query(
      `UPDATE job_requests SET status = 'APPROVED', reviewed_by_user_id = $2, reviewed_at = now() WHERE id = $1`,
      [requestId, managerId]
    );

    // Create the assignment awaiting driver acceptance. The partial unique
    // index guarantees one live assignment per driver â catch the race.
    let assignmentId;
    try {
      const a = await client.query(
        `INSERT INTO job_assignments (job_id, driver_id, status, assigned_by_user_id)
         VALUES ($1, $2, 'PENDING_DRIVER_ACCEPTANCE', $3)
         RETURNING id`,
        [req.job_id, req.driver_id, managerId]
      );
      assignmentId = a.rows[0].id;
    } catch (err) {
      if (err.code === '23505') throw new WorkflowError('Driver already has a live assignment', 'DRIVER_BUSY');
      throw err;
    }

    const job = (await client.query('SELECT * FROM jobs WHERE id = $1', [req.job_id])).rows[0];
    await setJobStatus(client, job, 'MANAGER_APPROVED', { actorType: 'MANAGER', actorUserId: managerId });
    await recordEvent(client, { jobId: job.id, assignmentId, eventType: 'REQUEST_APPROVED', data: { driver_id: req.driver_id } });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'JOB_REQUEST_APPROVED', entityType: 'JOB', entityId: job.id,
      after: { request_id: requestId, assignment_id: assignmentId },
    });
    await client.query('COMMIT');

    const driver = (await pool.query(
      `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
        LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
       WHERE d.id = $1`,
      [req.driver_id]
    )).rows[0];
    return { job, driver, assignmentId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rejectRequest(requestId, managerId = DEMO_MANAGER_ID, reason = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqR = await client.query(
      `SELECT jr.*, j.organization_id FROM job_requests jr JOIN jobs j ON j.id = jr.job_id
        WHERE jr.id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqR.rows.length === 0) throw new WorkflowError('Request not found', 'NOT_FOUND');
    const req = reqR.rows[0];
    if (req.status !== 'REQUESTED') throw new WorkflowError(`Request is ${req.status}, cannot reject`, 'BAD_STATE');

    await client.query(
      `UPDATE job_requests SET status = 'REJECTED', reviewed_by_user_id = $2, reviewed_at = now(), cancel_reason = $3 WHERE id = $1`,
      [requestId, managerId, reason]
    );

    const job = (await client.query('SELECT * FROM jobs WHERE id = $1', [req.job_id])).rows[0];
    const others = await client.query(
      `SELECT 1 FROM job_requests WHERE job_id = $1 AND status = 'REQUESTED' LIMIT 1`,
      [job.id]
    );
    if (others.rows.length === 0 && job.current_status === 'DRIVER_REQUESTED') {
      await setJobStatus(client, job, 'PUBLISHED', { actorType: 'MANAGER', actorUserId: managerId });
    }
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'JOB_REQUEST_REJECTED', entityType: 'JOB', entityId: job.id,
    });
    await client.query('COMMIT');

    const driver = (await pool.query(
      `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
        LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
       WHERE d.id = $1`,
      [req.driver_id]
    )).rows[0];
    return { job, driver };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Driver accepts the approved offer â job ASSIGNED. */

async function acceptJob(driver, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM drivers WHERE id = $1 FOR UPDATE', [driver.id]);
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || assignment.status !== 'PENDING_DRIVER_ACCEPTANCE') {
      throw new WorkflowError('No approved job offer is waiting for you', 'NO_OFFER');
    }

    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];
    // A published job can be offered to several matched drivers at once: the
    // first acceptance wins, so re-check that the job is still unassigned
    // under the row lock before letting this driver in.
    if (!['MANAGER_APPROVED', 'ASSIGNMENT_SENT', 'PUBLISHED', 'DRIVER_REQUESTED'].includes(job.current_status)) {
      throw new WorkflowError(`${job.job_number} has just been taken by another driver`, 'JOB_TAKEN');
    }

    await client.query(
      `UPDATE job_assignments SET status = 'ASSIGNED', accepted_at = now() WHERE id = $1`,
      [assignment.id]
    );
    // Close every other pending offer for this job: it has its driver now.
    await client.query(
      `UPDATE job_assignments SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'Job accepted by another driver'
        WHERE job_id = $1 AND status = 'PENDING_DRIVER_ACCEPTANCE' AND id <> $2`,
      [job.id, assignment.id]
    );
    await setJobStatus(client, job, 'ASSIGNED', { actorType: 'DRIVER', actorDriverId: driver.id });
    await client.query('UPDATE drivers SET active_job_id = $2 WHERE id = $1', [driver.id, job.id]);
    await client.query(`UPDATE conversations SET job_id = $2 WHERE driver_id = $1 AND status = 'OPEN'`, [driver.id, job.id]);
    await recordEvent(client, { jobId: job.id, assignmentId: assignment.id, messageId, eventType: 'ACCEPT_JOB', confidence });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'DRIVER', actorDriverId: driver.id,
      action: 'JOB_ACCEPTED', entityType: 'JOB', entityId: job.id,
    });
    await client.query('COMMIT');
    return { job, assignment };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Driver declines the approved offer â job back to PUBLISHED. */

async function declineJob(driver, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || assignment.status !== 'PENDING_DRIVER_ACCEPTANCE') {
      throw new WorkflowError('No approved job offer is waiting for you', 'NO_OFFER');
    }
    await client.query(`UPDATE job_assignments SET status = 'DECLINED' WHERE id = $1`, [assignment.id]);

    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];
    const others = await client.query(
      `SELECT 1 FROM job_requests WHERE job_id = $1 AND status = 'REQUESTED' LIMIT 1`,
      [job.id]
    );
    await setJobStatus(client, job, others.rows.length > 0 ? 'DRIVER_REQUESTED' : 'PUBLISHED',
      { actorType: 'DRIVER', actorDriverId: driver.id });
    await recordEvent(client, { jobId: job.id, assignmentId: assignment.id, messageId, eventType: 'DECLINE_JOB', confidence });
    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      type: 'OFFER_DECLINED',
      title: `${driver.name} declined ${job.job_number}`,
      body: 'The approved driver declined the offer. The job is back in the published pool.',
      severity: 'WARNING',
    });
    await client.query('COMMIT');
    return { job };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * System offer to a matched driver when a job is published â assignment
 * PENDING_DRIVER_ACCEPTANCE, exactly like a manager approval creates.
 *
 * The job status deliberately stays PUBLISHED: every matched driver gets the
 * same offer and the first acceptance wins (acceptJob enforces that under the
 * job row lock). Idempotent per job+driver, and a driver only ever holds one
 * pending offer: an older outstanding one is superseded.
 */

async function startJob(driver, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || !['ASSIGNED', 'ACTIVE'].includes(assignment.status)) {
      throw new WorkflowError('You can only start a job that is assigned to you', 'BAD_STATE');
    }
    // Already running (repeat "start the job"): report success without writing
    // a second START_JOB event.
    if (assignment.status === 'ACTIVE') {
      const running = (await client.query('SELECT * FROM jobs WHERE id = $1', [assignment.job_id])).rows[0];
      await client.query('COMMIT');
      return { job: running, assignment, alreadyStarted: true };
    }
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];

    // The 24-hour start window: an assigned job can only be started within
    // 24 hours before its scheduled pickup time. Enforced here in the backend
    // so no chat phrasing, button or document can bypass it.
    if (job.pickup_at) {
      const earliest = new Date(new Date(job.pickup_at).getTime() - START_WINDOW_MS);
      if (Date.now() < earliest.getTime()) {
        throw new WorkflowError(
          `This job can only be started within 24 hours of the scheduled pickup time. Pickup is scheduled for ${fmtWhen(job.pickup_at)}, so you can start it from ${fmtWhen(earliest)}.`,
          'START_TOO_EARLY'
        );
      }
    }

    await client.query(
      `UPDATE job_assignments SET status = 'ACTIVE', started_at = now() WHERE id = $1`,
      [assignment.id]
    );
    await setJobStatus(client, job, 'IN_PROGRESS', { actorType: 'DRIVER', actorDriverId: driver.id });
    await recordEvent(client, { jobId: job.id, assignmentId: assignment.id, messageId, eventType: 'START_JOB', confidence });
    await client.query('COMMIT');
    return { job, assignment };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The single executor for every trip-milestone transition.
 *
 * Runs inside one transaction and does, in order:
 *   1. lock the job + assignment,
 *   2. ask the state machine what the requested move means,
 *   3. write the inferred intermediate states (marked system-inferred),
 *   4. write the target state,
 *   5. update jobs.current_status.
 *
 * The AI never reaches this function with authority: it supplies `eventType`,
 * and everything about whether that is legal is decided here.
 *
 * @param {object} p
 * @param {object} p.client       an open transaction client (job already locked)
 * @param {object} p.job          the locked jobs row (mutated in place)
 * @param {object|null} p.assignment
 * @param {string} p.eventType    target milestone
 * @param {object} [p.data]       event payload for the target milestone
 * @param {'CHAT'|'DOCUMENT'|'MANAGER'} [p.source]
 * @param {object} p.actor        { actorType, actorDriverId?, actorUserId? }
 * @returns {Promise<{ applied: string[], inferred: string[], newStatus: string,
 *                     kind: string, noop: boolean }>}
 */

async function reportDelay(driver, data, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || assignment.status !== 'ACTIVE') {
      throw new WorkflowError('No started job â delays can only be reported on a started job', 'BAD_STATE');
    }
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];

    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment.id, messageId,
      eventType: 'DELAY_REPORTED', data, confidence,
    });
    const delayStage = ['PICKUP', 'DELIVERY'].includes(data.stage) ? data.stage : null;
    const delayReason = String(data.reason ?? 'Delay reported').trim().slice(0, 500);
    if (delayStage) {
      const reasonColumn = delayStage === 'PICKUP' ? 'pickup_delay_reason' : 'delivery_delay_reason';
      await client.query(
        `UPDATE jobs SET ${reasonColumn} = COALESCE(${reasonColumn}, $2) WHERE id = $1`,
        [job.id, delayReason],
      );
    }
    await setJobStatus(client, job, 'DELAYED', { actorType: 'DRIVER', actorDriverId: driver.id });
    const minutes = Number(data.delay_minutes) || 0;
    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      type: 'DELAY',
      title: `${job.job_number} delayed`,
      body: `${driver.name}: ${data.reason ?? 'delay reported'}${minutes ? ` (~${minutes} min)` : ''}`,
      severity: minutes >= 60 ? 'HIGH' : 'WARNING',
    });
    await client.query('COMMIT');
    return { job, assignment };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Damage / shortage / refusal / accident / breakdown â incident record +
 * manager alert. ACCIDENT/BREAKDOWN/FAILED_DELIVERY also move the job status.
 */

async function applyPendingVerifications(driver, messageId = null) {
  const assignment = await getDriverAssignment(pool, driver.id);
  if (!assignment) return null;
  return applyPendingVerificationsForJob(assignment.job_id, messageId);
}

/** Driver asks to cancel after approval/start â CANCELLATION_REVIEW (never auto-close). */

async function requestCancellation(driver, reason, messageId, confidence) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignment = await getDriverAssignment(client, driver.id);
    if (!assignment || !['PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'ACTIVE'].includes(assignment.status)) {
      throw new WorkflowError('No assignment to cancel', 'BAD_STATE');
    }
    await client.query(
      `UPDATE job_assignments SET status = 'CANCELLATION_REVIEW', cancellation_reason = $2 WHERE id = $1`,
      [assignment.id, reason ?? null]
    );
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [assignment.job_id])).rows[0];
    await setJobStatus(client, job, 'CANCELLATION_REVIEW', { actorType: 'DRIVER', actorDriverId: driver.id });
    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment.id, messageId,
      eventType: 'CANCELLATION_REQUESTED', status: 'REVIEW_REQUIRED',
      data: { reason: reason ?? null, stage: assignment.status }, confidence,
    });
    await notifyManagers(client, {
      organizationId: job.organization_id,
      jobId: job.id,
      type: 'CANCELLATION_REQUEST',
      title: `${driver.name} wants to cancel ${job.job_number}`,
      body: `Stage: ${assignment.status}. Reason: ${reason ?? 'not given'}. Review in the job detail page.`,
      severity: assignment.status === 'ACTIVE' ? 'CRITICAL' : 'HIGH',
    });
    await client.query('COMMIT');
    return { job, assignment };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Manager decision on a cancellation review: release | reject | cancel. */

async function resolveCancellation(jobId, action, managerId = DEMO_MANAGER_ID) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job || job.current_status !== 'CANCELLATION_REVIEW') {
      throw new WorkflowError('Job is not in cancellation review', 'BAD_STATE');
    }
    const aR = await client.query(
      `SELECT * FROM job_assignments WHERE job_id = $1 AND status = 'CANCELLATION_REVIEW' LIMIT 1`,
      [jobId]
    );
    if (aR.rows.length === 0) throw new WorkflowError('No assignment under review', 'BAD_STATE');
    const assignment = aR.rows[0];

    let driverFreed = false;
    if (action === 'release') {
      await client.query(`UPDATE job_assignments SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`, [assignment.id]);
      await setJobStatus(client, job, 'PUBLISHED', { actorType: 'MANAGER', actorUserId: managerId });
      driverFreed = true;
    } else if (action === 'cancel') {
      await client.query(`UPDATE job_assignments SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`, [assignment.id]);
      await setJobStatus(client, job, 'CANCELLED', { actorType: 'MANAGER', actorUserId: managerId });
      driverFreed = true;
    } else if (action === 'reject') {
      const backTo = assignment.started_at ? 'ACTIVE' : 'ASSIGNED';
      await client.query(`UPDATE job_assignments SET status = $2, cancellation_reason = NULL WHERE id = $1`, [assignment.id, backTo]);
      const rank = await currentMilestoneRank(client, job);
      const status = Object.keys(MILESTONE_RANK).find((k) => MILESTONE_RANK[k] === rank) ?? (backTo === 'ACTIVE' ? 'IN_PROGRESS' : 'ASSIGNED');
      await setJobStatus(client, job, status, { actorType: 'MANAGER', actorUserId: managerId });
    } else {
      throw new WorkflowError(`Unknown cancellation action: ${action}`, 'BAD_ACTION');
    }

    if (driverFreed) {
      await client.query('UPDATE drivers SET active_job_id = NULL WHERE id = $1', [assignment.driver_id]);
    }
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: `CANCELLATION_${action.toUpperCase()}`, entityType: 'JOB', entityId: job.id,
    });
    await client.query('COMMIT');

    const driver = (await pool.query(
      `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
        LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
       WHERE d.id = $1`,
      [assignment.driver_id]
    )).rows[0];
    return { job, driver, assignment };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Manager cancels a job outright (any non-final state). */

async function managerCancelJob(jobId, reason, managerId = DEMO_MANAGER_ID) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (['COMPLETED', 'CANCELLED'].includes(job.current_status)) {
      throw new WorkflowError(`Job is already ${job.current_status}`, 'BAD_STATE');
    }

    // Open driver requests no longer make sense.
    await client.query(`UPDATE job_requests SET status = 'EXPIRED' WHERE job_id = $1 AND status = 'REQUESTED'`, [jobId]);

    // Cancel the live assignment (if any) and free the driver.
    const aR = await client.query(
      `SELECT * FROM job_assignments
        WHERE job_id = $1 AND status IN ('PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
        LIMIT 1`,
      [jobId]
    );
    const assignment = aR.rows[0] ?? null;
    if (assignment) {
      await client.query(
        `UPDATE job_assignments SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = $2 WHERE id = $1`,
        [assignment.id, reason ?? 'Cancelled by manager']
      );
      await client.query('UPDATE drivers SET active_job_id = NULL WHERE id = $1', [assignment.driver_id]);
    }

    await setJobStatus(client, job, 'CANCELLED', { actorType: 'MANAGER', actorUserId: managerId });
    await recordEvent(client, {
      jobId, assignmentId: assignment?.id ?? null,
      eventType: 'JOB_CANCELLED_BY_MANAGER', data: { reason: reason ?? null },
    });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'JOB_CANCELLED', entityType: 'JOB', entityId: jobId,
      after: { reason: reason ?? null },
    });
    await client.query('COMMIT');

    const driver = assignment
      ? (await pool.query(
          `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
            LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
           WHERE d.id = $1`,
          [assignment.driver_id]
        )).rows[0]
      : null;
    return { job, driver };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Manager handles an incident: 'resolve' closes it (restoring an
 * INCIDENT_OPEN job to its furthest milestone), 'under_review' marks it
 * being worked on, 'keep_open' reopens it.
 */

async function submitCompletion(jobId, managerId = DEMO_MANAGER_ID) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (!['DELIVERED', 'DELIVERED_WITH_EXCEPTION'].includes(job.current_status)) {
      throw new WorkflowError(`Job is ${job.current_status} â only delivered trips can be submitted for closure`, 'BAD_STATE');
    }
    const aR = await client.query(
      `SELECT * FROM job_assignments WHERE job_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [jobId]
    );
    const assignment = aR.rows[0] ?? null;
    if (assignment) {
      await client.query(
        `UPDATE job_assignments SET completion_submitted_at = now() WHERE id = $1`,
        [assignment.id]
      );
    }
    await setJobStatus(client, job, 'MANAGER_REVIEW', { actorType: 'MANAGER', actorUserId: managerId });
    await recordEvent(client, {
      jobId: job.id, assignmentId: assignment?.id ?? null, eventType: 'COMPLETION_SUBMITTED',
    });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'COMPLETION_SUBMITTED', entityType: 'JOB', entityId: job.id,
    });
    await client.query('COMMIT');

    const driver = assignment
      ? (await pool.query(
          `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
            LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
           WHERE d.id = $1`,
          [assignment.driver_id]
        )).rows[0]
      : null;
    return { job, driver };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Manager marks a reviewed job as done â COMPLETED, driver becomes available. */

async function completeJob(jobId, managerId = DEMO_MANAGER_ID) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (![
      'DELIVERED',
      'DELIVERED_WITH_EXCEPTION',
      'DRIVER_SUBMITTED_COMPLETION',
      'MANAGER_REVIEW',
      'REQUIRES_CORRECTION',
    ].includes(job.current_status)) {
      // A double-click on Confirm Closure (or a repeat API call) lands here:
      // the job is already done, so report that instead of failing, and write
      // no duplicate completion/release events.
      if (job.current_status === 'COMPLETED') {
        await client.query('COMMIT');
        return { job, driver: null, alreadyCompleted: true };
      }
      throw new WorkflowError(`Job is ${job.current_status} â only jobs submitted for completion can be marked done`, 'BAD_STATE');
    }
    const aR = await client.query(
      `SELECT * FROM job_assignments WHERE job_id = $1 AND status IN ('ACTIVE', 'ASSIGNED') LIMIT 1`,
      [jobId]
    );
    const assignment = aR.rows[0] ?? null;

    await setJobStatus(client, job, 'COMPLETED', { actorType: 'MANAGER', actorUserId: managerId });
    await recordEvent(client, {
      jobId, assignmentId: assignment?.id ?? null,
      eventType: 'JOB_COMPLETED', data: { approved_by: managerId },
    });
    await client.query(
      `UPDATE jobs SET completed_at = now(), completed_by_user_id = $2 WHERE id = $1`,
      [jobId, managerId]
    );
    if (assignment) {
      await client.query(
        `UPDATE job_assignments SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
        [assignment.id]
      );
      await client.query('UPDATE drivers SET active_job_id = NULL WHERE id = $1', [assignment.driver_id]);
    }
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'JOB_COMPLETED', entityType: 'JOB', entityId: job.id,
    });
    await client.query('COMMIT');

    const driver = assignment
      ? (await pool.query(
          `SELECT d.id, d.name, wa.phone_e164 FROM drivers d
            LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
           WHERE d.id = $1`,
          [assignment.driver_id]
        )).rows[0]
      : null;
    return { job, driver };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Manager asks the driver for a correction â REQUIRES_CORRECTION. */

async function requestCorrection(jobId, note, managerId = DEMO_MANAGER_ID) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new WorkflowError('Job not found', 'NOT_FOUND');
    if (!['DRIVER_SUBMITTED_COMPLETION', 'MANAGER_REVIEW'].includes(job.current_status)) {
      throw new WorkflowError('Corrections can only be requested during completion review', 'BAD_STATE');
    }
    await setJobStatus(client, job, 'REQUIRES_CORRECTION', { actorType: 'MANAGER', actorUserId: managerId });
    await audit(client, {
      organizationId: job.organization_id,
      actorType: 'MANAGER', actorUserId: managerId,
      action: 'CORRECTION_REQUESTED', entityType: 'JOB', entityId: job.id,
      after: { note },
    });
    await client.query('COMMIT');

    const aR = await pool.query(
      `SELECT d.id, d.name, wa.phone_e164 FROM job_assignments ja
        JOIN drivers d ON d.id = ja.driver_id
        LEFT JOIN driver_whatsapp_accounts wa ON wa.driver_id = d.id AND wa.is_primary
       WHERE ja.job_id = $1 AND ja.status = 'ACTIVE' LIMIT 1`,
      [jobId]
    );
    return { job, driver: aR.rows[0] ?? null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Documents (Phase 5)
// ---------------------------------------------------------------------------

/**
 * Link media attachments to a job as a DOCUMENT_RECEIVED workflow event.
 * The attachment -> message -> conversation chain is the audit trail; the
 * event carries the attachment ids + detected document type (POD / OTHER).
 */

module.exports = {
  DEMO_MANAGER_ID,
  MILESTONE_EVENTS,
  MILESTONE_RANK,
  PROTECTED_MILESTONES: sm.PROTECTED_MILESTONES,
  stateMachine: sm,
  describeProgress,
  protectionFloorRank,
  INCIDENT_TYPES,
  SEVERITIES,
  WorkflowError,
  getDriverAssignment,
  getJobByNumber,
  listAvailableJobs,
  getPendingRequest,
  attachDocuments,
  verifyDocument,
  hasPodDocument,
  listRecentJobsForDriver,
  requestJob,
  cancelJobRequest,
  approveRequest,
  rejectRequest,
  acceptJob,
  declineJob,
  offerJobToDriver,
  startJob,
  applyMilestone,
  reportDelay,
  recordStageDelay,
  stageDelay,
  applyPendingVerifications,
  applyPendingVerificationsForJob,
  verifyStageByManager,
  reportIncident,
  requestCancellation,
  resolveCancellation,
  releaseDriver,
  resetJob,
  managerCancelJob,
  resolveIncident,
  endJob,
  findJobsDueForAutoClosure,
  requestClosureAuto,
  AUTO_CLOSURE_DELAY_MINUTES,
  fmtWhen,
  submitCompletion,
  completeJob,
  requestCorrection,
  notifyManagers,
  recordEvent,
  audit,
  setJobStatus,
  currentMilestoneRank,
};
