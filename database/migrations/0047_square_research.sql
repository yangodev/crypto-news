ALTER TABLE square_traces ADD COLUMN trace_version integer NOT NULL DEFAULT 1;
CREATE TABLE square_research (
 id bigserial PRIMARY KEY,
 topic_key text NOT NULL UNIQUE,
 title text NOT NULL,
 pillar text NOT NULL,
 brief text NOT NULL,
 needs text NOT NULL,
 terms text[] NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','drafting','needs_sources','review','approved','skipped','failed')),
 body text,
 sources jsonb NOT NULL DEFAULT '[]',
 receipt_id bigint REFERENCES receipts(id),
 note text,
 attempted_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1
);
CREATE TABLE square_research_days (
 day date PRIMARY KEY,
 topic_id bigint NOT NULL REFERENCES square_research(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
