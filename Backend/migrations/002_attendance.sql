-- Offline-first attendance: when the student scanned, as opposed to when the server received it
-- (created_at). Idempotent, safe to re-run.
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
