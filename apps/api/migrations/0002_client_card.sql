-- Owner request 2026-11-07: client card for staff, note to the client on every decision,
-- privacy notice acknowledgement at booking, health data (allergies) only with explicit consent.

-- Note from the salon to the client, sent with accept / decline / "Rücksprache" (replaces decline_reason).
ALTER TABLE appointment ADD COLUMN client_note text CHECK (length(client_note) <= 500);
UPDATE appointment SET client_note = decline_reason WHERE decline_reason IS NOT NULL;
ALTER TABLE appointment DROP COLUMN decline_reason;

-- Proof that the privacy notice (Art. 13 DSGVO) was shown and acknowledged, with the text version.
ALTER TABLE customer ADD COLUMN privacy_ack_at timestamptz;
ALTER TABLE customer ADD COLUMN privacy_ack_version text;

-- Health data (allergies, intolerances) is a special category (Art. 9 DSGVO): stored only with explicit consent.
ALTER TABLE customer ADD COLUMN health_consent_at timestamptz;
ALTER TABLE customer ADD COLUMN health_consent_by uuid REFERENCES staff_user(id);
ALTER TABLE customer ADD COLUMN health_notes text CHECK (length(health_notes) <= 2000);
ALTER TABLE customer ADD CONSTRAINT health_notes_need_consent CHECK (health_notes IS NULL OR health_consent_at IS NOT NULL);

-- Client card entries written by staff: colour recipes (product, shade, amounts) and general notes.
CREATE TABLE customer_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('color', 'note')),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  author_id   uuid REFERENCES staff_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_entry_customer ON customer_entry (tenant_id, customer_id, created_at DESC);
