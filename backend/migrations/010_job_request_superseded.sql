-- Supersede competing requests.
ALTER TABLE job_requests DROP CONSTRAINT job_requests_status_check;

ALTER TABLE job_requests ADD CONSTRAINT job_requests_status_check
    CHECK (status IN ('REQUESTED', 'CANCELLED_BY_DRIVER', 'REJECTED', 'APPROVED', 'EXPIRED', 'SUPERSEDED'));
