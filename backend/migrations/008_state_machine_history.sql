-- State-machine history.

CREATE INDEX IF NOT EXISTS idx_workflow_events_job_applied_type
    ON workflow_events (job_id, event_type)
    WHERE event_status = 'APPLIED';

CREATE INDEX IF NOT EXISTS idx_workflow_events_inferred
    ON workflow_events (job_id)
    WHERE event_data ? 'inferred';

CREATE OR REPLACE VIEW job_status_history AS
SELECT
    we.job_id,
    we.id                                      AS event_id,
    we.event_type,
    we.event_status,
    we.created_at,
    we.applied_at,
    we.source_message_id,
    COALESCE((we.event_data ->> 'inferred')::boolean, FALSE)   AS system_inferred,
    COALESCE((we.event_data ->> 'correction')::boolean, FALSE) AS is_correction,
    (we.event_data -> 'verification' ->> 'stage')              AS verified_stage,
    (we.event_data -> 'verification' ->> 'method')             AS verified_method,
    we.event_data
FROM workflow_events we
ORDER BY we.job_id, we.created_at;
