-- Extends `members` to capture the richer professional/biographical roster
-- data NBA Ado-Ekiti actually collects via its Google Forms "Bio Data"
-- registration (Title, SCN, Year of Call, law firm/employer, NBA Section &
-- Forum membership, emergency contact) rather than just the broadcast-only
-- fields the Phase-1 template covered. Added to `members` directly (not a
-- separate table) since it's a strict one-to-one extension of the same
-- person record, not a repeating/many-valued relationship.
--
-- Deliberately NOT captured here, present in the source form but out of
-- scope for this pass: date of birth (the form only collects month/day,
-- no year, and doesn't map to a plain DATE column), professional portrait
-- photo link, CAC registration number, website URL, and the org-level
-- secondary/alternate contact fields (name/phone for a firm's front-desk
-- contact, not the member themselves).

CREATE TYPE practice_sector_enum AS ENUM (
    'private_practice', 'ministry_civil_service', 'corporate_in_house_judiciary', 'academia'
);

ALTER TABLE members
    ADD COLUMN title                        TEXT,
    ADD COLUMN middle_name                  TEXT,
    ADD COLUMN professional_suffix          TEXT,
    ADD COLUMN scn                          TEXT,
    ADD COLUMN year_of_call                 INTEGER,
    -- Comma-separated multi-select fields in the source form (a member can
    -- belong to more than one NBA Section/Forum at once) — arrays, not a
    -- controlled-vocabulary enum, since NBA can add new Sections/Fora over
    -- time without a schema change.
    ADD COLUMN nba_section                  TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN nba_forum                    TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN emergency_contact_name       TEXT,
    ADD COLUMN emergency_contact_relationship TEXT,
    ADD COLUMN emergency_contact_phone      TEXT,
    ADD COLUMN employer_name                TEXT,
    ADD COLUMN designation                  TEXT,
    ADD COLUMN sector                       practice_sector_enum,
    ADD COLUMN employer_address             TEXT;
