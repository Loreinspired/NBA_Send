-- broadcasts.updated_at: lets broadcast-reaper.workflow.json distinguish a
-- broadcast that's genuinely still being processed from one whose pipeline
-- execution crashed or hung mid-run. created_at can't be reused for this —
-- it marks when the broadcast was submitted, not when it was last claimed
-- or touched, so a broadcast that waited a while in 'pending' before being
-- claimed would look stuck immediately. Set explicitly by the claim and
-- terminal-status Postgres nodes in broadcast-main.workflow.json (no
-- trigger, to keep the write path visible in the workflow's own SQL rather
-- than hidden in schema).
ALTER TABLE broadcasts ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
