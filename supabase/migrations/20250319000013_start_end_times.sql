-- 013: Add start_time and end_time to time_entries
ALTER TABLE time_entries ADD COLUMN start_time time;
ALTER TABLE time_entries ADD COLUMN end_time time;

-- Relax the unique constraint to allow multiple entries per worker/date/block/task
-- (e.g. morning and afternoon shifts)
ALTER TABLE time_entries DROP CONSTRAINT uq_time_entry;
