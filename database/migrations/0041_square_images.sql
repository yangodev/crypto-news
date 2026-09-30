ALTER TABLE square_drafts ADD COLUMN cover_status text NOT NULL DEFAULT 'pending' CHECK (cover_status IN ('pending','generating','generated','fallback'));
ALTER TABLE square_drafts ADD COLUMN cover_key text;
ALTER TABLE square_drafts ADD COLUMN cover_error text;
ALTER TABLE square_drafts ADD COLUMN cover_updated_at timestamptz;
INSERT INTO budgets(service,per_minute,per_hour,per_day,note) VALUES('image',2,6,20,'生图请求次数上限，非金额预算') ON CONFLICT DO NOTHING;
