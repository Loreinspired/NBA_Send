-- Lets admins tag contacts with reusable, free-form group names (e.g.
-- "Conference 2026", "Debtors Q1") and target a broadcast at either
-- specific groups, specific individually-selected contacts, or both —
-- alongside the three fixed audience_segment_enum values that already
-- exist. Modeled as a plain TEXT[] tag column on `members`, the same
-- pattern already used for nba_section/nba_forum
-- (014_member_biodata_fields.sql): no separate groups table, since these
-- are lightweight ad-hoc labels with no metadata of their own, not
-- first-class entities needing referential integrity. Renaming a group
-- later is a bulk UPDATE across members, not a single-row edit — an
-- accepted tradeoff of this simpler model.
ALTER TABLE members ADD COLUMN custom_groups TEXT[] NOT NULL DEFAULT '{}';

-- ALTER TYPE ... ADD VALUE must commit before the new value can be used
-- elsewhere — safe here because db/migrate.sh runs each statement in a
-- migration file as its own implicit transaction (psql's default
-- AUTOCOMMIT, no explicit BEGIN wrapping the file), not one transaction
-- for the whole file.
ALTER TYPE audience_segment_enum ADD VALUE 'custom';

-- Null for every non-custom broadcast; for a 'custom' one, at least one of
-- these two is expected to be non-null/non-empty (enforced in
-- admin-gui/server.js, not a CHECK constraint here, to keep the same
-- validation-lives-in-the-app-layer approach already used for every other
-- broadcast field).
ALTER TABLE broadcasts ADD COLUMN target_groups TEXT[];
ALTER TABLE broadcasts ADD COLUMN target_member_ids UUID[];
