-- Stage delays.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS pickup_actual_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pickup_delay_reason    TEXT,
    ADD COLUMN IF NOT EXISTS delivery_actual_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivery_delay_reason  TEXT;

-- The auto-closure sweeper polls for delivered jobs past the closure window.
CREATE INDEX IF NOT EXISTS idx_jobs_auto_closure
    ON jobs (current_status)
    WHERE current_status IN ('DELIVERED', 'DELIVERED_WITH_EXCEPTION');
