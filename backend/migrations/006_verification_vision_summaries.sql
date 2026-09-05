-- Verification, vision, and summaries.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pickup_code  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS pickup_verified_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_verified_at TIMESTAMPTZ;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pickup_proof_attachment_id  UUID REFERENCES attachments (id),
  ADD COLUMN IF NOT EXISTS delivery_proof_attachment_id UUID REFERENCES attachments (id);

CREATE TABLE IF NOT EXISTS job_summaries (
    job_id          UUID PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
    driver_id       UUID REFERENCES drivers (id),
    summary_text    TEXT NOT NULL DEFAULT '',
    last_message_id UUID,
    message_count   INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS r2_key     TEXT,
  ADD COLUMN IF NOT EXISTS public_url TEXT,
  ADD COLUMN IF NOT EXISTS vision     JSONB;

ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_attachment_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_attachment_type_check
  CHECK (attachment_type IN ('AUDIO', 'IMAGE', 'DOCUMENT', 'VIDEO'));

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS location_lat         NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS location_lng         NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS location_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backup_vehicle       VARCHAR(20);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('TEXT', 'AUDIO', 'IMAGE', 'DOCUMENT', 'BUTTON', 'SYSTEM', 'LOCATION', 'VIDEO'));
