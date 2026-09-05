-- Track when the manager last opened each conversation so incoming driver
-- messages can be surfaced as unread in the conversation list.

ALTER TABLE conversations
    ADD COLUMN manager_last_read_at TIMESTAMPTZ;

-- Existing conversations were already visible before this feature shipped.
-- Treat their history as read so only newly received driver messages alert managers.
UPDATE conversations
   SET manager_last_read_at = now();
