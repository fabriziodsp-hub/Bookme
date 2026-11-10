-- Owner request 2026-11-10 (D-052): public salon homepage before booking.
-- Texts written by the salon (no invented marketing copy); empty = section hidden.
ALTER TABLE tenant ADD COLUMN homepage jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Team on the homepage only with the person's consent (opt-in, off by default) and only under a
-- public name the person chooses (e.g. first name or nickname) – never the full name.
ALTER TABLE stylist ADD COLUMN public_name text CHECK (length(public_name) BETWEEN 1 AND 40);
ALTER TABLE stylist ADD COLUMN show_public boolean NOT NULL DEFAULT false;
ALTER TABLE stylist ADD CONSTRAINT stylist_public_needs_name CHECK (NOT show_public OR public_name IS NOT NULL);
