-- RLS-safe functions backing two new admin-gui features: defining/editing
-- sender profiles, and bulk-importing members from a CSV export of the
-- branch's Google Sheet roster. Same pattern as
-- 012_rls_helper_functions.sql (PERFORM set_config(...) then the real
-- query, as sequential statements in one PL/pgSQL function body — see that
-- file's header comment for why a WITH-CTE version doesn't work) and same
-- reason for SECURITY INVOKER (the default — do not add SECURITY DEFINER):
-- RLS must apply as nba_app_runtime, not as the migration-owner role.

-- Upsert rather than plain insert: sender_profiles has a UNIQUE(branch_id,
-- role) constraint (only one PRO/Chairman/Secretariat profile per branch),
-- so "define" a role that's already defined means redefine it in place,
-- not error. Always sets is_active = true — defining a profile implies you
-- want it usable; see set_sender_profile_active() below to deactivate one
-- without deleting it.
-- RETURNS TABLE columns are prefixed out_ to avoid a real, confirmed bug:
-- an OUT parameter named the same as a plain table column (e.g. `role`)
-- becomes a PL/pgSQL variable in scope for the whole function body,
-- including the ON CONFLICT target list below — which, per SQL syntax,
-- must be bare unqualified column names (no `sender_profiles.role`
-- allowed there), so it silently resolves to the PL/pgSQL variable instead
-- of the table's column and Postgres raises "column reference is
-- ambiguous". Hit and confirmed this exact error while testing this
-- function locally.
CREATE FUNCTION upsert_sender_profile(
    p_branch_id        uuid,
    p_role             text,
    p_display_name     text,
    p_signature_block  text,
    p_contact_phone    text,
    p_contact_email    text
) RETURNS TABLE (
    out_id               uuid,
    out_role             text,
    out_display_name     text,
    out_signature_block  text,
    out_contact_phone    text,
    out_contact_email    text,
    out_is_active        boolean
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        INSERT INTO sender_profiles (branch_id, role, display_name, signature_block, contact_phone, contact_email)
        VALUES (p_branch_id, p_role::sender_role_enum, p_display_name, p_signature_block, p_contact_phone, p_contact_email)
        ON CONFLICT (branch_id, role) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            signature_block = EXCLUDED.signature_block,
            contact_phone = EXCLUDED.contact_phone,
            contact_email = EXCLUDED.contact_email,
            is_active = true,
            updated_at = now()
        RETURNING sender_profiles.id, sender_profiles.role::text, sender_profiles.display_name,
                  sender_profiles.signature_block, sender_profiles.contact_phone,
                  sender_profiles.contact_email::text, sender_profiles.is_active;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_sender_profile(uuid, text, text, text, text, text) TO nba_app_runtime;

CREATE FUNCTION set_sender_profile_active(p_id uuid, p_is_active boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    UPDATE sender_profiles SET is_active = p_is_active, updated_at = now()
    WHERE sender_profiles.id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION set_sender_profile_active(uuid, boolean) TO nba_app_runtime;

-- Unlike list_sender_profiles() in 012 (active-only, backs the broadcast
-- composer's dropdown), this includes inactive rows so the management page
-- can show every role's current state, including ones deliberately turned
-- off.
CREATE FUNCTION list_sender_profiles_for_management(p_branch_slug text)
RETURNS TABLE (
    id               uuid,
    role             text,
    display_name     text,
    signature_block  text,
    contact_phone    text,
    contact_email    text,
    is_active        boolean
) LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        SELECT sp.id, sp.role::text, sp.display_name, sp.signature_block,
               sp.contact_phone, sp.contact_email::text, sp.is_active
        FROM sender_profiles sp
        JOIN branches b ON b.id = sp.branch_id
        WHERE b.slug = p_branch_slug
        ORDER BY sp.role;
END;
$$;
GRANT EXECUTE ON FUNCTION list_sender_profiles_for_management(text) TO nba_app_runtime;

-- Bulk-upserts a CSV import's rows in one call (one RLS context-set for
-- the whole batch, not one per row). p_rows is a JSON array of {first_name,
-- last_name, email, phone_number, financial_status} objects — admin-gui
-- validates and normalizes each row before calling this, so invalid rows
-- never reach here (a single CHECK-constraint violation, e.g. a malformed
-- phone number, would abort the whole INSERT statement, not just that
-- row). Matched to an existing member by (branch_id, phone_number) — the
-- same key the Phase-1 Sheets roster has always used (see
-- docs/MIGRATION.md). Deliberately does NOT touch committee_role or
-- amount_due on update: those aren't columns in the Sheet template
-- (docs/samples/nba_members_template.md), so a re-import must not clobber
-- values set by hand elsewhere in the app.
-- out_ prefix on RETURNS TABLE columns: same ON-CONFLICT-vs-OUT-parameter
-- ambiguity as upsert_sender_profile() above (phone_number is both a real
-- column referenced bare in the ON CONFLICT target list and would
-- otherwise be an OUT parameter name).
CREATE FUNCTION bulk_upsert_members(p_branch_id uuid, p_rows jsonb, p_created_by text)
RETURNS TABLE (out_member_id uuid, out_phone_number text, out_was_new boolean)
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        INSERT INTO members (branch_id, first_name, last_name, email, phone_number, financial_status, created_by)
        SELECT p_branch_id, r.first_name, r.last_name, NULLIF(r.email, ''), r.phone_number,
               r.financial_status::financial_status_enum, p_created_by
        FROM jsonb_to_recordset(p_rows) AS r(
            first_name text, last_name text, email text, phone_number text, financial_status text
        )
        ON CONFLICT (branch_id, phone_number) DO UPDATE SET
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            email = EXCLUDED.email,
            financial_status = EXCLUDED.financial_status,
            is_active = true,
            updated_at = now()
        -- xmax = 0 is a standard Postgres idiom for "this row was just
        -- inserted, not updated" (xmax is the deleting-transaction ID slot,
        -- unset/0 on a fresh insert; ON CONFLICT DO UPDATE sets it because
        -- the update is implemented as a delete+insert at the row-version
        -- level) — used here only to give admin-gui an accurate "N added,
        -- M updated" summary, not for any correctness-critical purpose.
        RETURNING members.id, members.phone_number, (xmax = 0);
END;
$$;
GRANT EXECUTE ON FUNCTION bulk_upsert_members(uuid, jsonb, text) TO nba_app_runtime;
