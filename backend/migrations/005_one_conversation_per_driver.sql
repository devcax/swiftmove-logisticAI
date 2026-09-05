-- One open conversation per driver.

DO $$
DECLARE
  dup     RECORD;
  keep_id UUID;
  other_id UUID;
  i       INTEGER;
  o_pending JSONB;
  o_job   UUID;
  o_last  TIMESTAMPTZ;
BEGIN
  FOR dup IN
    SELECT driver_id, array_agg(id ORDER BY created_at) AS ids
      FROM conversations
     WHERE status = 'OPEN'
     GROUP BY driver_id
    HAVING count(*) > 1
  LOOP
    keep_id := dup.ids[1];
    FOR i IN 2 .. array_length(dup.ids, 1) LOOP
      other_id := dup.ids[i];
      SELECT pending_action, job_id, last_message_at
        INTO o_pending, o_job, o_last
        FROM conversations WHERE id = other_id;
      UPDATE messages SET conversation_id = keep_id WHERE conversation_id = other_id;
      DELETE FROM conversations WHERE id = other_id;
      UPDATE conversations k
         SET pending_action = COALESCE(k.pending_action, o_pending),
             job_id         = COALESCE(k.job_id, o_job),
             last_message_at = GREATEST(k.last_message_at, o_last)
       WHERE k.id = keep_id;
    END LOOP;
  END LOOP;
END $$;

UPDATE conversations c
   SET job_id = d.active_job_id
  FROM drivers d
 WHERE d.id = c.driver_id
   AND c.status = 'OPEN'
   AND d.active_job_id IS NOT NULL
   AND c.job_id IS DISTINCT FROM d.active_job_id;

DROP INDEX IF EXISTS uq_conversations_open_job;
DROP INDEX IF EXISTS uq_conversations_open_general;
CREATE UNIQUE INDEX uq_conversations_one_open
    ON conversations (driver_id)
    WHERE status = 'OPEN';
