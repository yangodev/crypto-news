CREATE TABLE square_commands (
 id bigserial PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('prepare','trace','image','publish')),
 subject text NOT NULL,
 actor text NOT NULL,
 request_key text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 UNIQUE(actor,request_key)
);
CREATE UNIQUE INDEX square_command_active ON square_commands(kind,subject) WHERE status IN ('queued','running');
CREATE TABLE square_traces (
 article_id text PRIMARY KEY REFERENCES articles(id),
 article_revision integer NOT NULL,
 status text NOT NULL CHECK (status IN ('running','done','failed')),
 links jsonb NOT NULL DEFAULT '[]',
 note text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE square_drafts ADD COLUMN cover_error_code text;
ALTER TABLE square_drafts ADD COLUMN cover_retry_at timestamptz;
