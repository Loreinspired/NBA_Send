-- Backs the "n8n appends the chosen sender's branding/signature" routing
-- rule from the brief. One row per (branch, role).
CREATE TYPE sender_role_enum AS ENUM ('pro', 'branch_chairman', 'secretariat');

CREATE TABLE sender_profiles (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id        UUID NOT NULL REFERENCES branches(id),
    role             sender_role_enum NOT NULL,
    display_name     TEXT NOT NULL,
    signature_block  TEXT NOT NULL,
    contact_phone    TEXT,
    contact_email    CITEXT,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (branch_id, role)
);
