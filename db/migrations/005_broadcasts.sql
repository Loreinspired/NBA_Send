-- One row per admin-GUI "Broadcast" submission. channels is a small array
-- (email/whatsapp/sms) rather than a join table since it never grows past 3
-- fixed values and is always read/written as a unit.
CREATE TYPE audience_segment_enum AS ENUM ('all_members', 'executive_committee', 'financial_members');
CREATE TYPE broadcast_status_enum AS ENUM ('pending', 'in_progress', 'completed', 'failed');

CREATE TABLE broadcasts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id         UUID NOT NULL REFERENCES branches(id),
    sender_profile_id UUID NOT NULL REFERENCES sender_profiles(id),
    audience_segment  audience_segment_enum NOT NULL,
    channels          TEXT[] NOT NULL,
    message_template  TEXT NOT NULL,
    is_urgent         BOOLEAN NOT NULL DEFAULT false,
    status            broadcast_status_enum NOT NULL DEFAULT 'pending',
    requested_by      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_broadcasts_branch ON broadcasts(branch_id);
