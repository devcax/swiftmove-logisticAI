-- Milestones and demo data.

ALTER TABLE jobs DROP CONSTRAINT jobs_current_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_current_status_check
    CHECK (current_status IN (
        'DRAFT', 'PUBLISHED', 'DRIVER_REQUESTED', 'MANAGER_APPROVED',
        'ASSIGNMENT_SENT', 'ASSIGNED', 'IN_PROGRESS',
        'ARRIVED_AT_PICKUP', 'LOADING_STARTED', 'LOADED', 'DEPARTED',
        'ARRIVED_AT_DELIVERY', 'UNLOADING_STARTED', 'UNLOADED',
        'DELAYED', 'DELIVERED', 'DELIVERED_WITH_EXCEPTION', 'CANCELLATION_REVIEW',
        'INCIDENT_OPEN', 'DRIVER_SUBMITTED_COMPLETION', 'MANAGER_REVIEW',
        'REQUIRES_CORRECTION', 'COMPLETED', 'CANCELLED', 'FAILED_DELIVERY'
    ));


ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_action JSONB;


-- Manager user (dashboard has no login; this user is the default approver)
INSERT INTO users (id, organization_id, name, email, password_hash, status) VALUES
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001',
     'Operations Manager', 'manager@demologistics.co', 'login-disabled', 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
    SELECT '00000000-0000-0000-0000-000000000010', r.id FROM roles r WHERE r.code = 'MANAGER'
ON CONFLICT DO NOTHING;

-- Locations used by demo jobs
INSERT INTO locations (id, organization_id, name, address_line_1, city, state, country) VALUES
    ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001',
     'Chennai Warehouse', '12 Port Trust Road', 'Chennai', 'Tamil Nadu', 'India'),
    ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001',
     'Bengaluru Plant', '88 Peenya Industrial Area Phase 2', 'Bengaluru', 'Karnataka', 'India'),
    ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001',
     'Chennai South Yard', '45 GST Road, Tambaram', 'Chennai', 'Tamil Nadu', 'India'),
    ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001',
     'Hosur Factory Gate', '7 SIPCOT Industrial Complex', 'Hosur', 'Tamil Nadu', 'India')
ON CONFLICT DO NOTHING;

-- Demo jobs, PUBLISHED so drivers can request them through the bot
INSERT INTO jobs (id, organization_id, job_number, current_status, cargo_description,
                  pickup_at, delivery_at, special_instructions, published_at, created_by_user_id) VALUES
    ('00000000-0000-0000-0000-000000001041', '00000000-0000-0000-0000-000000000001',
     'JOB-1041', 'PUBLISHED', 'Packaged food cartons',
     now() + interval '1 day', now() + interval '1 day 6 hours', NULL, now(),
     '00000000-0000-0000-0000-000000000010'),
    ('00000000-0000-0000-0000-000000001042', '00000000-0000-0000-0000-000000000001',
     'JOB-1042', 'PUBLISHED', 'Industrial components',
     now() + interval '1 day', now() + interval '1 day 8 hours',
     'Signed POD required from the receiver.', now(),
     '00000000-0000-0000-0000-000000000010'),
    ('00000000-0000-0000-0000-000000001045', '00000000-0000-0000-0000-000000000001',
     'JOB-1045', 'PUBLISHED', 'Auto spare parts',
     now() + interval '1 day 6 hours', now() + interval '2 days', NULL, now(),
     '00000000-0000-0000-0000-000000000010')
ON CONFLICT DO NOTHING;

-- Planned cargo per job
INSERT INTO job_items (job_id, description, planned_quantity, unit) VALUES
    ('00000000-0000-0000-0000-000000001041', 'Packaged food cartons', 22, 'boxes'),
    ('00000000-0000-0000-0000-000000001042', 'Industrial components', 18, 'pallets'),
    ('00000000-0000-0000-0000-000000001045', 'Auto spare parts', 10, 'pallets');

-- Pickup + delivery stops per job
INSERT INTO job_stops (job_id, location_id, stop_sequence, stop_type, appointment_at) VALUES
    ('00000000-0000-0000-0000-000000001041', '00000000-0000-0000-0000-000000000101', 1, 'PICKUP',   now() + interval '1 day'),
    ('00000000-0000-0000-0000-000000001041', '00000000-0000-0000-0000-000000000102', 2, 'DELIVERY', now() + interval '1 day 6 hours'),
    ('00000000-0000-0000-0000-000000001042', '00000000-0000-0000-0000-000000000101', 1, 'PICKUP',   now() + interval '1 day'),
    ('00000000-0000-0000-0000-000000001042', '00000000-0000-0000-0000-000000000102', 2, 'DELIVERY', now() + interval '1 day 8 hours'),
    ('00000000-0000-0000-0000-000000001045', '00000000-0000-0000-0000-000000000103', 1, 'PICKUP',   now() + interval '1 day 6 hours'),
    ('00000000-0000-0000-0000-000000001045', '00000000-0000-0000-0000-000000000104', 2, 'DELIVERY', now() + interval '2 days')
ON CONFLICT DO NOTHING;
