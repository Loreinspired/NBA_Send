-- Each branch (Ado-Ekiti today, ~125 branches nationally at scale) is one row
-- here rather than a separate schema/database — see docs/ARCHITECTURE.md for
-- the row-level multi-tenancy rationale.
CREATE TABLE branches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    sms_sender_id TEXT NOT NULL,
    timezone      TEXT NOT NULL DEFAULT 'Africa/Lagos',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
