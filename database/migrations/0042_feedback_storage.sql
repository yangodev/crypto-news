ALTER TABLE feedback ADD COLUMN IF NOT EXISTS screenshot_bytes bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS feedback_recent_source ON feedback (created_at, source_hash);
