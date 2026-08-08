-- Supports the whatsapp-interactive-reply workflow: captures the raw
-- RSVP/payment quick-reply button payload against the outbound message it
-- answers, so exco can see who replied and how without a separate table.
ALTER TABLE message_log
    ADD COLUMN reply_payload TEXT,
    ADD COLUMN replied_at TIMESTAMPTZ;
