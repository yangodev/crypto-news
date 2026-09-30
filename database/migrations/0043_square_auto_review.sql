ALTER TABLE square_drafts ADD COLUMN auto_review jsonb;
ALTER TABLE square_drafts ADD COLUMN review_claim_until timestamptz;
ALTER TABLE square_control ADD COLUMN auto_started_at timestamptz;
ALTER TABLE square_control ADD COLUMN hourly_limit integer NOT NULL DEFAULT 1 CHECK(hourly_limit BETWEEN 1 AND 5);
ALTER TABLE square_control ADD COLUMN daily_limit integer NOT NULL DEFAULT 5 CHECK(daily_limit BETWEEN 1 AND 20);
