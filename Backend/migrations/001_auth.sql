-- Phase 1: server-verified WebAuthn device binding (idempotent, safe to re-run).
ALTER TABLE user_device ADD COLUMN IF NOT EXISTS sign_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_device ADD COLUMN IF NOT EXISTS transports TEXT[];
ALTER TABLE user_device ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- One active (non-revoked) device per student.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_device_per_student
    ON user_device (external_user_id)
    WHERE revoked_at IS NULL;
