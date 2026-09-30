-- Private draft queue; no row is publishable without later explicit verification.
CREATE TABLE square_drafts (
 id bigserial PRIMARY KEY,
 event_key text NOT NULL UNIQUE,
 article_id text NOT NULL REFERENCES articles(id),
 article_revision integer NOT NULL,
 title text NOT NULL,
 body text NOT NULL,
 content_hash text NOT NULL,
 evidence jsonb NOT NULL,
 status text NOT NULL DEFAULT 'review' CHECK (status IN ('review','ready','submitting','published','unknown','failed','expired','rejected')),
 review_reasons text[] NOT NULL DEFAULT '{}',
 verified_by text,
 verified_at timestamptz,
 expires_at timestamptz NOT NULL,
 platform_id text,
 platform_url text,
 attempted_at timestamptz,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX square_platform_id ON square_drafts(platform_id) WHERE platform_id IS NOT NULL;
CREATE TABLE square_control (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 paused boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO square_control(id,paused) VALUES(true,true);
