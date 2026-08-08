-- Column names deliberately mirror the Phase-1 Google Sheets headers
-- (First_Name, Last_Name, Email, Phone_Number, Financial_Status) so a CSV
-- export from the sheet can be \copy'd in with no transform step. See
-- docs/MIGRATION.md.
CREATE TYPE financial_status_enum AS ENUM ('financial', 'non_financial', 'unknown');
CREATE TYPE committee_role_enum AS ENUM ('none', 'executive', 'branch_officer');

CREATE TABLE members (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id         UUID NOT NULL REFERENCES branches(id),
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    email             CITEXT,
    phone_number      TEXT NOT NULL,
    financial_status  financial_status_enum NOT NULL DEFAULT 'unknown',
    committee_role    committee_role_enum NOT NULL DEFAULT 'none',
    amount_due        NUMERIC(12,2),
    is_active         BOOLEAN NOT NULL DEFAULT true,
    source_row_ref    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        TEXT,
    CONSTRAINT phone_e164_ng CHECK (phone_number ~ '^\+234[0-9]{10}$'),
    CONSTRAINT uq_member_branch_phone UNIQUE (branch_id, phone_number)
);

CREATE INDEX idx_members_branch ON members(branch_id);
CREATE INDEX idx_members_branch_financial ON members(branch_id, financial_status) WHERE is_active;
CREATE INDEX idx_members_branch_committee ON members(branch_id, committee_role) WHERE is_active;
