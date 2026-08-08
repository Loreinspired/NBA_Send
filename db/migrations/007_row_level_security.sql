-- Row-level multi-tenancy: every tenant-scoped table is readable/writable
-- only for the branch set in the `app.current_branch_id` session variable,
-- or for every branch when that variable is the literal string 'ALL' (the
-- National Executive overview case). See docs/ARCHITECTURE.md for why this
-- was chosen over schema-per-branch.
--
-- Callers must set the session variable before querying, e.g.:
--   SET app.current_branch_id = '3fa85f64-...';   -- branch-scoped
--   SET app.current_branch_id = 'ALL';             -- National overview
-- In n8n, this means an explicit "SET ..." statement executed in the same
-- Postgres node/session immediately before the scoped query (see
-- n8n/README.md). If the variable is never set, all policies below evaluate
-- to false and no rows are visible — a safe default, not an open one.

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sender_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY branch_scoped_members ON members
    USING (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    )
    WITH CHECK (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    );

CREATE POLICY branch_scoped_sender_profiles ON sender_profiles
    USING (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    )
    WITH CHECK (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    );

CREATE POLICY branch_scoped_broadcasts ON broadcasts
    USING (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    )
    WITH CHECK (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    );

CREATE POLICY branch_scoped_message_log ON message_log
    USING (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    )
    WITH CHECK (
        branch_id = NULLIF(current_setting('app.current_branch_id', true), 'ALL')::uuid
        OR current_setting('app.current_branch_id', true) = 'ALL'
    );

-- The migration runner (db/migrate.sh) connects as the table owner, who is
-- exempt from RLS by default — this is intentional so migrations and seeding
-- always work. The n8n application role must NOT be a table owner/superuser,
-- or these policies would be silently bypassed for real traffic too.
