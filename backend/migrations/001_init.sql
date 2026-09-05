-- Initial schema.

CREATE TABLE organizations (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                           VARCHAR(160) NOT NULL,
    official_whatsapp_display_name VARCHAR(160),
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id),
    name            VARCHAR(160) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    password_hash   TEXT NOT NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, email)
);

CREATE TABLE roles (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE user_roles (
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id    UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);


CREATE TABLE jobs (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES organizations (id),
    job_number           VARCHAR(80) NOT NULL,
    current_status       VARCHAR(50) NOT NULL DEFAULT 'DRAFT'
                         CHECK (current_status IN (
                             'DRAFT', 'PUBLISHED', 'DRIVER_REQUESTED', 'MANAGER_APPROVED',
                             'ASSIGNMENT_SENT', 'ASSIGNED', 'IN_PROGRESS', 'DELAYED',
                             'DELIVERED', 'DELIVERED_WITH_EXCEPTION', 'CANCELLATION_REVIEW',
                             'INCIDENT_OPEN', 'DRIVER_SUBMITTED_COMPLETION', 'MANAGER_REVIEW',
                             'REQUIRES_CORRECTION', 'COMPLETED', 'CANCELLED', 'FAILED_DELIVERY'
                         )),
    cargo_description    TEXT NOT NULL,
    pickup_at            TIMESTAMPTZ NOT NULL,
    delivery_at          TIMESTAMPTZ,
    special_instructions TEXT,
    published_at         TIMESTAMPTZ,
    created_by_user_id   UUID NOT NULL REFERENCES users (id),
    completed_by_user_id UUID REFERENCES users (id),
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, job_number)
);


CREATE TABLE drivers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id),
    name            VARCHAR(160) NOT NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    active_job_id   UUID REFERENCES jobs (id), -- convenience projection only
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE driver_whatsapp_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           UUID NOT NULL REFERENCES drivers (id) ON DELETE CASCADE,
    phone_e164          VARCHAR(30) NOT NULL UNIQUE,
    is_primary          BOOLEAN NOT NULL DEFAULT TRUE,
    verification_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REVOKED')),
    last_message_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id),
    name            VARCHAR(180) NOT NULL,
    address_line_1  VARCHAR(255) NOT NULL,
    address_line_2  VARCHAR(255),
    city            VARCHAR(100) NOT NULL,
    state           VARCHAR(100),
    postal_code     VARCHAR(30),
    country         VARCHAR(100) NOT NULL,
    contact_name    VARCHAR(160),
    contact_phone   VARCHAR(30),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id           UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    description      VARCHAR(255) NOT NULL,
    planned_quantity DECIMAL(12, 3) NOT NULL,
    unit             VARCHAR(40) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_stops (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id         UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    location_id    UUID NOT NULL REFERENCES locations (id),
    stop_sequence  INTEGER NOT NULL,
    stop_type      VARCHAR(30) NOT NULL
                   CHECK (stop_type IN ('PICKUP', 'DELIVERY')),
    appointment_at TIMESTAMPTZ,
    status         VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, stop_sequence)
);


CREATE TABLE job_requests (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id             UUID NOT NULL REFERENCES jobs (id),
    driver_id          UUID NOT NULL REFERENCES drivers (id),
    status             VARCHAR(40) NOT NULL DEFAULT 'REQUESTED'
                       CHECK (status IN ('REQUESTED', 'CANCELLED_BY_DRIVER', 'REJECTED', 'APPROVED', 'EXPIRED')),
    requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at       TIMESTAMPTZ,
    cancel_reason      TEXT,
    reviewed_by_user_id UUID REFERENCES users (id),
    reviewed_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one open request per driver and job
CREATE UNIQUE INDEX uq_job_requests_open
    ON job_requests (job_id, driver_id)
    WHERE status = 'REQUESTED';

CREATE TABLE job_assignments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                UUID NOT NULL REFERENCES jobs (id),
    driver_id             UUID NOT NULL REFERENCES drivers (id),
    status                VARCHAR(50) NOT NULL DEFAULT 'PENDING_DRIVER_ACCEPTANCE'
                          CHECK (status IN ('PENDING_DRIVER_ACCEPTANCE', 'ASSIGNED', 'DECLINED',
                                            'CANCELLATION_REVIEW', 'CANCELLED', 'ACTIVE', 'COMPLETED')),
    assigned_by_user_id   UUID NOT NULL REFERENCES users (id),
    assigned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at           TIMESTAMPTZ,
    started_at            TIMESTAMPTZ,
    completion_submitted_at TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,
    cancellation_reason   TEXT,
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent more than one live assignment for a driver
CREATE UNIQUE INDEX uq_job_assignments_one_active
    ON job_assignments (driver_id)
    WHERE status IN ('ASSIGNED', 'ACTIVE');


CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id),
    driver_id       UUID NOT NULL REFERENCES drivers (id),
    job_id          UUID REFERENCES jobs (id), -- nullable: general conversation while requesting
    status          VARCHAR(30) NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'CLOSED')),
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open job-specific conversation per driver and job
CREATE UNIQUE INDEX uq_conversations_open_job
    ON conversations (driver_id, job_id)
    WHERE status = 'OPEN' AND job_id IS NOT NULL;

-- One open general conversation per driver
CREATE UNIQUE INDEX uq_conversations_open_general
    ON conversations (driver_id)
    WHERE status = 'OPEN' AND job_id IS NULL;

CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     UUID NOT NULL REFERENCES conversations (id),
    external_message_id VARCHAR(255) UNIQUE, -- duplicate-message protection
    sender_type         VARCHAR(30) NOT NULL
                        CHECK (sender_type IN ('DRIVER', 'MANAGER', 'BOT', 'SYSTEM')),
    sender_driver_id    UUID REFERENCES drivers (id),
    sender_user_id      UUID REFERENCES users (id),
    message_type        VARCHAR(30) NOT NULL DEFAULT 'TEXT'
                        CHECK (message_type IN ('TEXT', 'AUDIO', 'IMAGE', 'DOCUMENT', 'BUTTON', 'SYSTEM')),
    source_type         VARCHAR(40) NOT NULL
                        CHECK (source_type IN ('DRIVER_MESSAGE', 'MANUAL_MANAGER_MESSAGE', 'BOT_MESSAGE', 'SYSTEM_MESSAGE')),
    body_text           TEXT,
    delivery_status     VARCHAR(30) NOT NULL DEFAULT 'RECEIVED'
                        CHECK (delivery_status IN ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED')),
    received_at         TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id        UUID NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    attachment_type   VARCHAR(30) NOT NULL
                      CHECK (attachment_type IN ('AUDIO', 'IMAGE', 'DOCUMENT')),
    storage_key       TEXT NOT NULL,
    original_filename VARCHAR(255),
    mime_type         VARCHAR(120) NOT NULL,
    file_size_bytes   BIGINT,
    checksum_sha256   VARCHAR(64),
    transcription_text TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_interpretations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id        UUID NOT NULL UNIQUE REFERENCES messages (id),
    model_name        VARCHAR(120) NOT NULL,
    prompt_version    VARCHAR(40) NOT NULL,
    primary_intent    VARCHAR(60) NOT NULL,
    structured_output JSONB NOT NULL,
    confidence_score  DECIMAL(5, 4) CHECK (confidence_score BETWEEN 0 AND 1),
    processing_status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                      CHECK (processing_status IN ('PENDING', 'COMPLETED', 'FAILED', 'REQUIRES_REVIEW')),
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE workflow_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs (id),
    assignment_id     UUID REFERENCES job_assignments (id),
    source_message_id UUID REFERENCES messages (id),
    event_type        VARCHAR(60) NOT NULL,
    event_status      VARCHAR(30) NOT NULL DEFAULT 'PROPOSED'
                      CHECK (event_status IN ('PROPOSED', 'CONFIRMED', 'APPLIED', 'REJECTED', 'REVIEW_REQUIRED')),
    event_data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_score  DECIMAL(5, 4) CHECK (confidence_score BETWEEN 0 AND 1),
    effective_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_confirmations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_event_id       UUID NOT NULL UNIQUE REFERENCES workflow_events (id),
    confirmation_message_id UUID NOT NULL REFERENCES messages (id),
    result                  VARCHAR(30) NOT NULL
                            CHECK (result IN ('CONFIRMED', 'CORRECTED', 'REJECTED')),
    corrected_data          JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE incidents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES jobs (id),
    assignment_id       UUID REFERENCES job_assignments (id),
    reported_by_driver_id UUID NOT NULL REFERENCES drivers (id),
    source_message_id   UUID REFERENCES messages (id),
    incident_type       VARCHAR(40) NOT NULL
                        CHECK (incident_type IN ('ACCIDENT', 'BREAKDOWN', 'DAMAGE', 'SHORTAGE', 'REFUSAL', 'OTHER')),
    severity            VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
                        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description         TEXT NOT NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
    manager_notes       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    resolved_by_user_id UUID REFERENCES users (id)
);

CREATE TABLE incident_attachments (
    incident_id   UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES attachments (id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (incident_id, attachment_id)
);


CREATE TABLE notifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations (id),
    job_id           UUID REFERENCES jobs (id),
    incident_id      UUID REFERENCES incidents (id),
    recipient_user_id UUID NOT NULL REFERENCES users (id),
    notification_type VARCHAR(50) NOT NULL,
    title            VARCHAR(180) NOT NULL,
    body             TEXT NOT NULL,
    severity         VARCHAR(20) NOT NULL DEFAULT 'INFO'
                     CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
    read_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id),
    actor_type      VARCHAR(30) NOT NULL
                    CHECK (actor_type IN ('DRIVER', 'MANAGER', 'BOT', 'SYSTEM')),
    actor_user_id   UUID REFERENCES users (id),
    actor_driver_id UUID REFERENCES drivers (id),
    action          VARCHAR(80) NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID NOT NULL,
    before_data     JSONB,
    after_data      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE INDEX idx_jobs_current_status            ON jobs (current_status);
CREATE INDEX idx_job_requests_status            ON job_requests (status);
CREATE INDEX idx_job_assignments_driver_status  ON job_assignments (driver_id, status);
CREATE INDEX idx_messages_conversation_created  ON messages (conversation_id, created_at);
CREATE INDEX idx_workflow_events_job_created    ON workflow_events (job_id, created_at);
CREATE INDEX idx_incidents_status_severity      ON incidents (status, severity);
CREATE INDEX idx_notifications_recipient_read   ON notifications (recipient_user_id, read_at);
CREATE INDEX idx_audit_logs_entity              ON audit_logs (entity_type, entity_id);


CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_driver_whatsapp_accounts_updated_at BEFORE UPDATE ON driver_whatsapp_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_job_stops_updated_at BEFORE UPDATE ON job_stops FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_job_requests_updated_at BEFORE UPDATE ON job_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_job_assignments_updated_at BEFORE UPDATE ON job_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
