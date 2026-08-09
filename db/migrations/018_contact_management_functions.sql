-- RLS-safe functions backing admin-gui's new Contacts management tab —
-- same PERFORM set_config()-then-query pattern as every other function
-- since 012 (see that migration's header comment for why). No ON CONFLICT
-- in any of these, so unlike upsert_sender_profile/bulk_upsert_members,
-- there's no OUT-parameter/bare-column-name collision risk to work around
-- (confirmed by direct testing) — RETURNS TABLE columns use their natural
-- names.
--
-- "Delete" is soft (is_active = false), not a real DELETE: message_log.
-- member_id is a NOT NULL REFERENCES members(id) with no ON DELETE
-- CASCADE, so hard-deleting a member with any delivery history would fail
-- outright on the FK constraint. Matches the same is_active pattern
-- sender_profiles already uses (013's set_sender_profile_active).

CREATE FUNCTION list_members(p_branch_slug text)
RETURNS TABLE (
    member_id         uuid,
    first_name        text,
    last_name         text,
    email             citext,
    phone_number      text,
    financial_status  financial_status_enum,
    committee_role    committee_role_enum,
    amount_due        numeric,
    custom_groups     text[],
    is_active         boolean
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone_number,
               m.financial_status, m.committee_role, m.amount_due, m.custom_groups, m.is_active
        FROM members m
        JOIN branches b ON b.id = m.branch_id
        WHERE b.slug = p_branch_slug
        ORDER BY m.last_name, m.first_name;
END;
$$;
GRANT EXECUTE ON FUNCTION list_members(text) TO nba_app_runtime;

CREATE FUNCTION create_member(
    p_branch_id        uuid,
    p_first_name       text,
    p_last_name        text,
    p_email            text,
    p_phone_number     text,
    p_financial_status text,
    p_committee_role   text,
    p_amount_due       numeric,
    p_custom_groups    text[],
    p_created_by       text
) RETURNS TABLE (
    member_id uuid, first_name text, last_name text, email citext, phone_number text,
    financial_status financial_status_enum, committee_role committee_role_enum,
    amount_due numeric, custom_groups text[], is_active boolean
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        INSERT INTO members (
            branch_id, first_name, last_name, email, phone_number,
            financial_status, committee_role, amount_due, custom_groups, created_by
        )
        VALUES (
            p_branch_id, p_first_name, p_last_name, NULLIF(p_email, ''), p_phone_number,
            p_financial_status::financial_status_enum, p_committee_role::committee_role_enum,
            p_amount_due, COALESCE(p_custom_groups, '{}'::text[]), p_created_by
        )
        RETURNING members.id, members.first_name, members.last_name, members.email, members.phone_number,
                  members.financial_status, members.committee_role, members.amount_due,
                  members.custom_groups, members.is_active;
END;
$$;
GRANT EXECUTE ON FUNCTION create_member(uuid, text, text, text, text, text, text, numeric, text[], text) TO nba_app_runtime;

CREATE FUNCTION update_member(
    p_id               uuid,
    p_first_name       text,
    p_last_name        text,
    p_email            text,
    p_phone_number     text,
    p_financial_status text,
    p_committee_role   text,
    p_amount_due       numeric,
    p_custom_groups    text[]
) RETURNS TABLE (
    member_id uuid, first_name text, last_name text, email citext, phone_number text,
    financial_status financial_status_enum, committee_role committee_role_enum,
    amount_due numeric, custom_groups text[], is_active boolean
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        UPDATE members SET
            first_name = p_first_name,
            last_name = p_last_name,
            email = NULLIF(p_email, ''),
            phone_number = p_phone_number,
            financial_status = p_financial_status::financial_status_enum,
            committee_role = p_committee_role::committee_role_enum,
            amount_due = p_amount_due,
            custom_groups = COALESCE(p_custom_groups, '{}'::text[]),
            updated_at = now()
        WHERE members.id = p_id
        RETURNING members.id, members.first_name, members.last_name, members.email, members.phone_number,
                  members.financial_status, members.committee_role, members.amount_due,
                  members.custom_groups, members.is_active;
END;
$$;
GRANT EXECUTE ON FUNCTION update_member(uuid, text, text, text, text, text, text, numeric, text[]) TO nba_app_runtime;

CREATE FUNCTION set_member_active(p_id uuid, p_is_active boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    UPDATE members SET is_active = p_is_active, updated_at = now() WHERE members.id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION set_member_active(uuid, boolean) TO nba_app_runtime;

-- Backs the broadcast composer's "Custom Selection" group checklist —
-- the distinct set of group names currently in use, so the UI can offer
-- them without the admin retyping/guessing at spelling.
CREATE FUNCTION list_distinct_custom_groups(p_branch_slug text)
RETURNS TABLE (group_name text) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT DISTINCT g
        FROM members m
        JOIN branches b ON b.id = m.branch_id
        CROSS JOIN LATERAL unnest(m.custom_groups) AS g
        WHERE b.slug = p_branch_slug AND m.is_active = true
        ORDER BY g;
END;
$$;
GRANT EXECUTE ON FUNCTION list_distinct_custom_groups(text) TO nba_app_runtime;
