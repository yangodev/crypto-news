-- Only one external submission can be in flight across workers.
CREATE UNIQUE INDEX square_single_submission ON square_drafts ((true)) WHERE status='submitting';
