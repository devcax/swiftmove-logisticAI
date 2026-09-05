-- Add read status.

ALTER TABLE messages DROP CONSTRAINT messages_delivery_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_delivery_status_check
    CHECK (delivery_status IN ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'));
