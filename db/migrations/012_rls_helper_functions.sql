-- Fixes a real bug in every RLS-scoped query written so far: wrapping
-- `set_config('app.current_branch_id', ...)` in a CTE that the main query
-- never references (`WITH _ctx AS (SELECT set_config(...)) SELECT ...`)
-- does NOT work — confirmed by direct testing. Postgres doesn't materialize
-- an unreferenced CTE at all (the set_config call never runs), and even
-- when forced to run via a CROSS JOIN, the planner is free to evaluate the
-- RLS policy's USING clause on the protected table before that CTE, since
-- both are just quals ANDed together with no ordering guarantee — RLS
-- fails closed, so both failure modes look like "no rows"/"insert
-- rejected", not an error, which is exactly why this went undetected until
-- now. It has never worked, in n8n's workflow nodes or anywhere else.
--
-- The only ordering PostgreSQL actually guarantees is sequential execution
-- of statements *within a single PL/pgSQL function body*. Every query that
-- needs `app.current_branch_id` set now goes through one of the functions
-- below: `PERFORM set_config(...)` runs first, then the real query, both
-- inside one function call — which n8n's Postgres node and admin-gui can
-- both invoke as a single ordinary parameterized statement
-- (`SELECT * FROM fn($1, ...)`), with no multi-statement connection
-- affinity or manual SQL-escaping required. Deliberately SECURITY INVOKER
-- (the default — not stated explicitly do not add SECURITY DEFINER): RLS
-- must apply as whichever role actually calls the function
-- (`nba_app_runtime`), not as the migration-owner role that defines it.
-- Every function is granted to `nba_app_runtime` only.

CREATE FUNCTION claim_next_pending_broadcast()
RETURNS TABLE (
    broadcast_id      uuid,
    branch_id         uuid,
    sender_profile_id uuid,
    audience_segment  audience_segment_enum,
    channels          text[],
    message_template  text,
    is_urgent         boolean,
    requested_by      text
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
                  broadcasts.message_template, broadcasts.is_urgent, broadcasts.requested_by;
END;
$$;
GRANT EXECUTE ON FUNCTION claim_next_pending_broadcast() TO nba_app_runtime;

CREATE FUNCTION fetch_sender_profile(p_sender_profile_id uuid)
RETURNS TABLE (
    sender_profile_id uuid,
    display_name      text,
    signature_block    text,
    contact_phone      text,
    contact_email      citext,
    branch_id          uuid,
    sms_sender_id       text
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT sp.id, sp.display_name, sp.signature_block, sp.contact_phone, sp.contact_email,
               b.id, b.sms_sender_id
        FROM sender_profiles sp
        JOIN branches b ON b.id = sp.branch_id
        WHERE sp.id = p_sender_profile_id AND sp.is_active = true;
END;
$$;
GRANT EXECUTE ON FUNCTION fetch_sender_profile(uuid) TO nba_app_runtime;

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
    branch_id         uuid
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone_number,
               m.financial_status, m.committee_role, m.amount_due, m.branch_id
        FROM members m
        WHERE m.branch_id = p_branch_id AND m.is_active = true;
END;
$$;
GRANT EXECUTE ON FUNCTION fetch_members_by_branch(uuid) TO nba_app_runtime;

CREATE FUNCTION insert_message_log(
    p_broadcast_id        uuid,
    p_member_id           uuid,
    p_branch_id           uuid,
    p_channel             text,
    p_recipient_address   text,
    p_status              text,
    p_provider_message_id text,
    p_error_detail        text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    INSERT INTO message_log (broadcast_id, member_id, branch_id, channel, recipient_address, status, provider_message_id, error_detail, sent_at)
    VALUES (
        p_broadcast_id, p_member_id, p_branch_id, p_channel::channel_enum, p_recipient_address,
        p_status::delivery_status_enum, p_provider_message_id, p_error_detail,
        CASE WHEN p_status = 'sent' THEN now() ELSE NULL END
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION insert_message_log(uuid, uuid, uuid, text, text, text, text, text) TO nba_app_runtime;

CREATE FUNCTION complete_broadcast(p_broadcast_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    UPDATE broadcasts SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE broadcasts.id = p_broadcast_id;
END;
$$;
GRANT EXECUTE ON FUNCTION complete_broadcast(uuid) TO nba_app_runtime;

-- Used by broadcast-reaper.workflow.json.
CREATE FUNCTION reap_stuck_broadcasts()
RETURNS TABLE (broadcast_id uuid) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        UPDATE broadcasts
        SET status = 'failed',
            failure_reason = 'Reaped: stuck in in_progress for over 10 minutes, likely a crashed or hung pipeline execution',
            updated_at = now()
        WHERE broadcasts.status = 'in_progress' AND broadcasts.updated_at < now() - interval '10 minutes'
        RETURNING broadcasts.id;
END;
$$;
GRANT EXECUTE ON FUNCTION reap_stuck_broadcasts() TO nba_app_runtime;

-- Used by admin-gui/server.js (GET /api/sender-profiles).
CREATE FUNCTION list_sender_profiles(p_branch_slug text)
RETURNS TABLE (
    id           uuid,
    role         text,
    display_name text
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT sp.id, sp.role::text, sp.display_name
        FROM sender_profiles sp
        JOIN branches b ON b.id = sp.branch_id
        WHERE b.slug = p_branch_slug AND sp.is_active = true
        ORDER BY sp.role;
END;
$$;
GRANT EXECUTE ON FUNCTION list_sender_profiles(text) TO nba_app_runtime;

-- Used by admin-gui/server.js (POST /api/broadcast). branch_id is resolved
-- by the caller first via a plain query (branches has no RLS — see
-- 007_row_level_security.sql), then passed in here.
CREATE FUNCTION create_broadcast(
    p_branch_id         uuid,
    p_sender_profile_id uuid,
    p_audience_segment  text,
    p_channels          text[],
    p_message_template  text,
    p_is_urgent         boolean,
    p_requested_by      text
) RETURNS TABLE (broadcast_id uuid, status text) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        INSERT INTO broadcasts (branch_id, sender_profile_id, audience_segment, channels, message_template, is_urgent, requested_by)
        VALUES (p_branch_id, p_sender_profile_id, p_audience_segment::audience_segment_enum, p_channels, p_message_template, p_is_urgent, p_requested_by)
        RETURNING broadcasts.id, broadcasts.status::text;
END;
$$;
GRANT EXECUTE ON FUNCTION create_broadcast(uuid, uuid, text, text[], text, boolean, text) TO nba_app_runtime;

-- Used by admin-gui/server.js (POST /webhooks/brevo-delivery-status/:secret).
CREATE FUNCTION update_message_log_status(p_provider_message_id text, p_status text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    UPDATE message_log
    SET status = p_status::delivery_status_enum, updated_at = now()
    WHERE message_log.provider_message_id = p_provider_message_id;
END;
$$;
GRANT EXECUTE ON FUNCTION update_message_log_status(text, text) TO nba_app_runtime;

-- Used by admin-gui/server.js (POST /webhooks/sendchamp-whatsapp-reply/:secret).
CREATE FUNCTION find_whatsapp_message_log(p_context_message_id text, p_from_phone text)
RETURNS TABLE (message_log_id uuid) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT ml.id
        FROM message_log ml
        WHERE ml.channel = 'whatsapp'
          AND (
              (p_context_message_id IS NOT NULL AND ml.provider_message_id = p_context_message_id)
              OR (p_context_message_id IS NULL AND ml.recipient_address = p_from_phone AND ml.status IN ('sent', 'delivered'))
          )
        ORDER BY ml.sent_at DESC NULLS LAST
        LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION find_whatsapp_message_log(text, text) TO nba_app_runtime;

CREATE FUNCTION update_message_log_reply(p_message_log_id uuid, p_reply_payload text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    UPDATE message_log
    SET reply_payload = p_reply_payload, replied_at = now()
    WHERE message_log.id = p_message_log_id;
END;
$$;
GRANT EXECUTE ON FUNCTION update_message_log_reply(uuid, text) TO nba_app_runtime;
