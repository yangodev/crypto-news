ALTER TABLE square_drafts ADD COLUMN revision_attempts integer NOT NULL DEFAULT 0 CHECK (revision_attempts BETWEEN 0 AND 1);
ALTER TABLE square_drafts ADD COLUMN review_history jsonb NOT NULL DEFAULT '[]';
ALTER TABLE square_drafts ADD COLUMN revision_receipt_id bigint REFERENCES receipts(id);
