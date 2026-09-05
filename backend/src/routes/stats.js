const express = require('express');
const { pool } = require('../db');

const router = express.Router();

const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';

const ACTIVE_STATUSES = [
  'MANAGER_APPROVED', 'ASSIGNMENT_SENT', 'ASSIGNED', 'IN_PROGRESS',
  'ARRIVED_AT_PICKUP', 'LOADING_STARTED', 'LOADED', 'DEPARTED',
  'ARRIVED_AT_DELIVERY', 'UNLOADING_STARTED', 'UNLOADED', 'DELAYED', 'INCIDENT_OPEN',
];
const LIVE_JOB_STATUSES = [
  'MANAGER_APPROVED', 'ASSIGNMENT_SENT', 'ASSIGNED', 'IN_PROGRESS',
  'ARRIVED_AT_PICKUP', 'LOADING_STARTED', 'LOADED', 'DEPARTED',
  'ARRIVED_AT_DELIVERY', 'UNLOADING_STARTED', 'UNLOADED', 'DELAYED',
  'INCIDENT_OPEN', 'CANCELLATION_REVIEW', 'DELIVERED',
  'DELIVERED_WITH_EXCEPTION', 'DRIVER_SUBMITTED_COMPLETION',
  'MANAGER_REVIEW', 'REQUIRES_CORRECTION',
];
const AWAITING_COMPLETION = ['DELIVERED', 'DELIVERED_WITH_EXCEPTION', 'DRIVER_SUBMITTED_COMPLETION', 'MANAGER_REVIEW', 'REQUIRES_CORRECTION'];

const STATUS_TEXT = {
  MANAGER_APPROVED: 'Approved, assignment being sent',
  ASSIGNMENT_SENT: 'Assignment sent to driver',
  ASSIGNED: 'Driver assigned',
  IN_PROGRESS: 'On the way',
  ARRIVED_AT_PICKUP: 'Arrived at pickup',
  LOADING_STARTED: 'Loading started',
  LOADED: 'Loaded, departing',
  DEPARTED: 'En route to delivery',
  ARRIVED_AT_DELIVERY: 'Arrived at delivery',
  UNLOADING_STARTED: 'Unloading started',
  UNLOADED: 'Unloaded',
  DELAYED: 'Running behind schedule',
  INCIDENT_OPEN: 'Incident reported',
};

function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function feedToneForIntent(intent) {
  const value = String(intent ?? '').toUpperCase();
  if (value.includes('INCIDENT') || value.includes('BREAKDOWN') || value.includes('ACCIDENT')) return 'error';
  if (value.includes('DELAY')) return 'warning';
  if (value.includes('COMPLET') || value.includes('DELIVERED') || value.includes('UNLOADED')) return 'success';
  return 'info';
}

router.get('/sidebar-counts', async (_req, res) => {
  try {
    const conversations = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM conversations c
        WHERE c.status = 'OPEN'
          AND (SELECT m.sender_type
                 FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1) = 'DRIVER'`
    );
    res.json({ conversations: conversations.rows[0].count });
  } catch (err) {
    console.error('sidebarCounts failed:', err.message);
    res.status(500).json({ error: 'Could not load sidebar counts.' });
  }
});

router.get('/sidebar-notifications', async (_req, res) => {
  try {
    const [driverMessages, liveJobs, incidents, jobRequests] = await Promise.all([
      pool.query(
        `SELECT id
           FROM messages
          WHERE sender_type = 'DRIVER'
          ORDER BY created_at DESC
          LIMIT 200`
      ),
      pool.query(
        `SELECT id, updated_at
           FROM jobs
          WHERE current_status = ANY($1)`,
        [LIVE_JOB_STATUSES]
      ),
      pool.query(
        `SELECT id
           FROM incidents
          WHERE status IN ('OPEN', 'UNDER_REVIEW')`
      ),
      pool.query(
        `SELECT id
           FROM job_requests
          WHERE status = 'REQUESTED'`
      ),
    ]);

    res.json({
      driverMessageIds: driverMessages.rows.map((row) => row.id),
      liveJobStamps: liveJobs.rows.map((row) => `${row.id}:${new Date(row.updated_at).getTime()}`),
      incidentIds: incidents.rows.map((row) => row.id),
      jobRequestIds: jobRequests.rows.map((row) => row.id),
    });
  } catch (err) {
    console.error('sidebarNotifications failed:', err.message);
    res.status(500).json({ error: 'Could not load sidebar notifications.' });
  }
});

router.get('/overview', async (_req, res) => {
  const client = await pool.connect();
  try {
    const [counts, requestCounts, incidentCounts] = await Promise.all([
      client.query(
        `SELECT
           COUNT(*) FILTER (WHERE current_status = 'PUBLISHED')::int AS published,
           COUNT(*) FILTER (WHERE current_status = 'DELAYED')::int AS delayed,
           COUNT(*) FILTER (WHERE current_status = ANY($2))::int AS active,
           COUNT(*) FILTER (WHERE current_status = ANY($3))::int AS awaiting
         FROM jobs WHERE organization_id = $1`,
        [DEMO_ORG_ID, ACTIVE_STATUSES, AWAITING_COMPLETION]
      ),
      client.query(
        `SELECT COUNT(*)::int AS count FROM job_requests WHERE status = 'REQUESTED'`
      ),
      client.query(
        `SELECT COUNT(*)::int AS count FROM incidents WHERE status IN ('OPEN', 'UNDER_REVIEW')`
      ),
    ]);

    const jobCounts = counts.rows[0];
    const driverRequests = requestCounts.rows[0].count;
    const openIncidents = incidentCounts.rows[0].count;

    const jobs = await client.query(
      `SELECT j.id, j.job_number, j.current_status, j.updated_at,
              pl.name AS origin, dl.name AS destination,
              d.name AS driver,
              (SELECT we.event_type FROM workflow_events we
                WHERE we.job_id = j.id ORDER BY we.created_at DESC LIMIT 1) AS last_event,
              (SELECT we.created_at FROM workflow_events we
                WHERE we.job_id = j.id ORDER BY we.created_at DESC LIMIT 1) AS last_event_at,
              (SELECT i.description FROM incidents i
                WHERE i.job_id = j.id AND i.status IN ('OPEN', 'UNDER_REVIEW')
                ORDER BY i.created_at DESC LIMIT 1) AS exception
         FROM jobs j
         LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
         LEFT JOIN locations pl ON pl.id = ps.location_id
         LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
         LEFT JOIN locations dl ON dl.id = ds.location_id
         LEFT JOIN job_assignments ja ON ja.job_id = j.id AND ja.status IN ('ASSIGNED', 'ACTIVE', 'CANCELLATION_REVIEW')
         LEFT JOIN drivers d ON d.id = ja.driver_id
        WHERE j.organization_id = $1 AND j.current_status = ANY($2)
        ORDER BY j.updated_at DESC
        LIMIT 12`,
      [DEMO_ORG_ID, ACTIVE_STATUSES]
    );

    const incidents = await client.query(
      `SELECT i.id, i.description, i.created_at, j.job_number
         FROM incidents i
         JOIN jobs j ON j.id = i.job_id
        WHERE i.status IN ('OPEN', 'UNDER_REVIEW')
        ORDER BY i.created_at DESC
        LIMIT 8`
    );

    const feed = await client.query(
      `SELECT ai.primary_intent, ai.confidence_score, ai.structured_output, ai.created_at, j.job_number
         FROM ai_interpretations ai
         JOIN messages m ON m.id = ai.message_id
         JOIN conversations c ON c.id = m.conversation_id
         JOIN jobs j ON j.id = c.job_id
        WHERE ai.processing_status = 'COMPLETED'
        ORDER BY ai.created_at DESC
        LIMIT 6`
    );

    const activeJobs = jobs.rows.map((r) => ({
      jobNumber: r.job_number,
      driver: r.driver ?? 'Unassigned',
      origin: r.origin ?? '—',
      destination: r.destination ?? '—',
      status: r.current_status,
      lastUpdate: describeLastUpdate(r),
      lastUpdateAgo: timeAgo(r.last_event_at ?? r.updated_at),
      exception: r.exception ?? (r.current_status === 'DELAYED' ? 'Running late' : r.current_status === 'INCIDENT_OPEN' ? 'Incident opened' : null),
    }));

    const kpis = [
      { label: 'Published Jobs', value: jobCounts.published, hint: 'in the pool', tone: 'primary' },
      { label: 'Driver Requests', value: driverRequests, hint: 'awaiting approval', tone: 'info' },
      { label: 'Active Jobs', value: jobCounts.active, hint: 'on the road', tone: 'primary' },
      { label: 'Delayed Jobs', value: jobCounts.delayed, hint: 'needs review', tone: 'warning' },
      { label: 'Open Incidents', value: openIncidents, hint: 'escalated', tone: 'error' },
      { label: 'Awaiting Completion', value: jobCounts.awaiting, hint: 'POD pending', tone: 'success' },
    ];

    res.json({
      kpis,
      activeJobs,
      openIncidents: incidents.rows.map((r) => ({
        id: `INC-${String(r.id).slice(0, 4).toUpperCase()}`,
        jobNumber: r.job_number,
        summary: r.description,
      })),
      recentAiEvents: feed.rows.map((r) => {
        const summary = r.structured_output && r.structured_output.summary
          ? String(r.structured_output.summary)
          : r.job_number;
        return {
          intent: r.primary_intent,
          detail: summary.includes(r.job_number) ? summary : `${summary} · ${r.job_number}`,
          confidence: r.confidence_score != null ? Math.round(Number(r.confidence_score) * 100) : 0,
          tone: feedToneForIntent(r.primary_intent),
        };
      }),
    });
  } catch (err) {
    console.error('overview failed:', err.message);
    res.status(500).json({ error: 'Could not load the operations overview.' });
  } finally {
    client.release();
  }
});

function describeLastUpdate(job) {
  if (job.last_event) {
    const label = String(job.last_event).replace(/_/g, ' ').toLowerCase();
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return STATUS_TEXT[job.current_status] ?? job.current_status;
}

module.exports = router;
