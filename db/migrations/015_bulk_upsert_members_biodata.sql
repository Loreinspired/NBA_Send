-- Replaces bulk_upsert_members() from 013 to also accept and write the
-- biodata fields added in 014. CREATE OR REPLACE rather than a fresh
-- function name: same identity, same callers (admin-gui's CSV importer),
-- just a richer row shape — no reason to leave the old narrower version
-- around too.
--
-- As with every other RLS-scoped function (see 012's header comment for
-- the full why), this is SECURITY INVOKER (the default) and sets
-- app.current_branch_id via PERFORM before the real query, both as
-- sequential statements in one function body.
CREATE OR REPLACE FUNCTION bulk_upsert_members(p_branch_id uuid, p_rows jsonb, p_created_by text)
RETURNS TABLE (out_member_id uuid, out_phone_number text, out_was_new boolean)
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.current_branch_id', 'ALL', false);
    RETURN QUERY
        INSERT INTO members (
            branch_id, first_name, last_name, email, phone_number, financial_status, created_by,
            title, middle_name, professional_suffix, scn, year_of_call,
            nba_section, nba_forum,
            emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
            employer_name, designation, sector, employer_address
        )
        SELECT
            p_branch_id, r.first_name, r.last_name, NULLIF(r.email, ''), r.phone_number,
            r.financial_status::financial_status_enum, p_created_by,
            NULLIF(r.title, ''), NULLIF(r.middle_name, ''), NULLIF(r.professional_suffix, ''),
            NULLIF(r.scn, ''), r.year_of_call,
            COALESCE(r.nba_section, '{}'::text[]), COALESCE(r.nba_forum, '{}'::text[]),
            NULLIF(r.emergency_contact_name, ''), NULLIF(r.emergency_contact_relationship, ''),
            NULLIF(r.emergency_contact_phone, ''),
            NULLIF(r.employer_name, ''), NULLIF(r.designation, ''),
            NULLIF(r.sector, '')::practice_sector_enum, NULLIF(r.employer_address, '')
        FROM jsonb_to_recordset(p_rows) AS r(
            first_name text, last_name text, email text, phone_number text, financial_status text,
            title text, middle_name text, professional_suffix text, scn text, year_of_call integer,
            nba_section text[], nba_forum text[],
            emergency_contact_name text, emergency_contact_relationship text, emergency_contact_phone text,
            employer_name text, designation text, sector text, employer_address text
        )
        ON CONFLICT (branch_id, phone_number) DO UPDATE SET
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            email = EXCLUDED.email,
            financial_status = EXCLUDED.financial_status,
            title = EXCLUDED.title,
            middle_name = EXCLUDED.middle_name,
            professional_suffix = EXCLUDED.professional_suffix,
            scn = EXCLUDED.scn,
            year_of_call = EXCLUDED.year_of_call,
            nba_section = EXCLUDED.nba_section,
            nba_forum = EXCLUDED.nba_forum,
            emergency_contact_name = EXCLUDED.emergency_contact_name,
            emergency_contact_relationship = EXCLUDED.emergency_contact_relationship,
            emergency_contact_phone = EXCLUDED.emergency_contact_phone,
            employer_name = EXCLUDED.employer_name,
            designation = EXCLUDED.designation,
            sector = EXCLUDED.sector,
            employer_address = EXCLUDED.employer_address,
            is_active = true,
            updated_at = now()
        RETURNING members.id, members.phone_number, (xmax = 0);
END;
$$;
GRANT EXECUTE ON FUNCTION bulk_upsert_members(uuid, jsonb, text) TO nba_app_runtime;
