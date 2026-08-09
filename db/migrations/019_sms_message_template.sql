-- Lets a broadcast carry a shorter, SMS-specific message alongside the
-- main message_template (used for email, and appended with the sender's
-- signature_block) — SMS is priced and rendered per 160-character segment,
-- so a message tuned for email/WhatsApp length routinely blows past one
-- segment. Nullable: only required (enforced in admin-gui/server.js, same
-- app-layer-validation approach as every other broadcast field) when 'sms'
-- is one of the selected channels.
ALTER TABLE broadcasts ADD COLUMN sms_message_template TEXT;

-- CREATE OR REPLACE cannot change a function's parameter list or its
-- RETURNS TABLE column list, even with identical parameters (confirmed by
-- direct testing in 017_custom_targeting_functions.sql) — DROP first.
DROP FUNCTION IF EXISTS claim_next_pending_broadcast();

CREATE FUNCTION claim_next_pending_broadcast()
RETURNS TABLE (
    broadcast_id         uuid,
    branch_id            uuid,
    sender_profile_id    uuid,
    audience_segment     audience_segment_enum,
    channels              text[],
    message_template     text,
    sms_message_template text,
    is_urgent            boolean,
    requested_by         text,
    target_groups        text[],
    target_member_ids    uuid[]
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
                  broadcasts.message_template, broadcasts.sms_message_template,
                  broadcasts.is_urgent, broadcasts.requested_by,
                  broadcasts.target_groups, broadcasts.target_member_ids;
END;
$$;
GRANT EXECUTE ON FUNCTION claim_next_pending_broadcast() TO nba_app_runtime;

DROP FUNCTION IF EXISTS create_broadcast(uuid, uuid, text, text[], text, boolean, text, text[], uuid[]);

CREATE FUNCTION create_broadcast(
    p_branch_id             uuid,
    p_sender_profile_id     uuid,
    p_audience_segment      text,
    p_channels              text[],
    p_message_template      text,
    p_is_urgent             boolean,
    p_requested_by          text,
    p_target_groups         text[] DEFAULT NULL,
    p_target_member_ids     uuid[] DEFAULT NULL,
    p_sms_message_template  text DEFAULT NULL
) RETURNS TABLE (broadcast_id uuid, status text) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        INSERT INTO broadcasts (
            branch_id, sender_profile_id, audience_segment, channels, message_template,
            is_urgent, requested_by, target_groups, target_member_ids, sms_message_template
        )
        VALUES (
            p_branch_id, p_sender_profile_id, p_audience_segment::audience_segment_enum, p_channels,
            p_message_template, p_is_urgent, p_requested_by, p_target_groups, p_target_member_ids,
            p_sms_message_template
        )
        RETURNING broadcasts.id, broadcasts.status::text;
END;
$$;
GRANT EXECUTE ON FUNCTION create_broadcast(uuid, uuid, text, text[], text, boolean, text, text[], uuid[], text) TO nba_app_runtime;
