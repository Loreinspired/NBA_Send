-- Extends three existing RLS-safe functions from 012 to carry the custom
-- targeting fields added in 016 all the way through the broadcast
-- pipeline: admin-gui writes them (create_broadcast), n8n's Schedule
-- Trigger reads them back off the claimed row (claim_next_pending_broadcast)
-- and needs each member's own group tags to filter against
-- (fetch_members_by_branch). CREATE OR REPLACE, not new function names —
-- same identity, same callers, richer shape (same reasoning as
-- 015_bulk_upsert_members_biodata.sql replacing bulk_upsert_members).

-- CREATE OR REPLACE cannot change a function's RETURN TABLE column list
-- either, even with identical parameters (confirmed by direct testing —
-- Postgres: "cannot change return type of existing function... Row type
-- defined by OUT parameters is different"). Drop first, same reasoning as
-- create_broadcast below.
DROP FUNCTION IF EXISTS claim_next_pending_broadcast();

CREATE FUNCTION claim_next_pending_broadcast()
RETURNS TABLE (
    broadcast_id      uuid,
    branch_id         uuid,
    sender_profile_id uuid,
    audience_segment  audience_segment_enum,
    channels          text[],
    message_template  text,
    is_urgent         boolean,
    requested_by      text,
    target_groups     text[],
    target_member_ids uuid[]
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        UPDATE broadcasts SET status = 'in_progress', updated_at = now()
        WHERE broadcasts.id = (
            SELECT b2.id FROM broadcasts b2
            WHERE b2.status = 'pending'
            ORDER BY b2.created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING broadcasts.id, broadcasts.branch_id, broadcasts.sender_profile_id,
                  broadcasts.audience_segment, broadcasts.channels,
                  broadcasts.message_template, broadcasts.is_urgent, broadcasts.requested_by,
                  broadcasts.target_groups, broadcasts.target_member_ids;
END;
$$;
GRANT EXECUTE ON FUNCTION claim_next_pending_broadcast() TO nba_app_runtime;

DROP FUNCTION IF EXISTS fetch_members_by_branch(uuid);

CREATE FUNCTION fetch_members_by_branch(p_branch_id uuid)
RETURNS TABLE (
    member_id         uuid,
    first_name        text,
    last_name         text,
    email             citext,
    phone_number      text,
    financial_status  financial_status_enum,
    committee_role    committee_role_enum,
    amount_due        numeric,
    branch_id         uuid,
    custom_groups     text[]
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone_number,
               m.financial_status, m.committee_role, m.amount_due, m.branch_id,
               m.custom_groups
        FROM members m
        WHERE m.branch_id = p_branch_id AND m.is_active = true;
END;
$$;
GRANT EXECUTE ON FUNCTION fetch_members_by_branch(uuid) TO nba_app_runtime;

-- CREATE OR REPLACE cannot change a function's parameter list — adding the
-- two new params (even with defaults) would silently create a second,
-- overloaded create_broadcast alongside the old 7-arg one instead of
-- replacing it (confirmed by direct testing), leaving the old version
-- reachable and out of sync with 016's new columns. Drop it explicitly
-- first.
DROP FUNCTION IF EXISTS create_broadcast(uuid, uuid, text, text[], text, boolean, text);

CREATE FUNCTION create_broadcast(
    p_branch_id         uuid,
    p_sender_profile_id uuid,
    p_audience_segment  text,
    p_channels          text[],
    p_message_template  text,
    p_is_urgent         boolean,
    p_requested_by      text,
    p_target_groups     text[] DEFAULT NULL,
    p_target_member_ids uuid[] DEFAULT NULL
) RETURNS TABLE (broadcast_id uuid, status text) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        INSERT INTO broadcasts (
            branch_id, sender_profile_id, audience_segment, channels, message_template,
            is_urgent, requested_by, target_groups, target_member_ids
        )
        VALUES (
            p_branch_id, p_sender_profile_id, p_audience_segment::audience_segment_enum, p_channels,
            p_message_template, p_is_urgent, p_requested_by, p_target_groups, p_target_member_ids
        )
        RETURNING broadcasts.id, broadcasts.status::text;
END;
$$;
GRANT EXECUTE ON FUNCTION create_broadcast(uuid, uuid, text, text[], text, boolean, text, text[], uuid[]) TO nba_app_runtime;
