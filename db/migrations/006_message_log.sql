-- Per-member, per-channel delivery audit trail. provider_message_id is used
-- to match inbound Sendchamp delivery-status callbacks back to a row.
CREATE TYPE channel_enum AS ENUM ('email', 'whatsapp', 'sms');
CREATE TYPE delivery_status_enum AS ENUM ('queued', 'sent', 'delivered', 'failed');

CREATE TABLE message_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id        UUID NOT NULL REFERENCES broadcasts(id),
    member_id           UUID NOT NULL REFERENCES members(id),
    branch_id           UUID NOT NULL REFERENCES branches(id),
    channel             channel_enum NOT NULL,
    recipient_address   TEXT NOT NULL,
    status              delivery_status_enum NOT NULL DEFAULT 'queued',
    provider_message_id TEXT,
    error_detail        TEXT,
    sent_at             TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_log_broadcast ON message_log(broadcast_id);
CREATE INDEX idx_message_log_provider_id ON message_log(provider_message_id);
