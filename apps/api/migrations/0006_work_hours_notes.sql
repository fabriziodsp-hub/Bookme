-- Owner request 2026-11-13 (D-071, D-072).
-- Personal working hours per person (NULL = the salon's opening hours). Times outside them count as
-- absence for availability and for staff placement.
ALTER TABLE stylist ADD COLUMN work_hours jsonb;

-- Internal calendar notes: an "absence" of kind 'note' with a text; it blocks the time only when
-- blocks = true (then it also gets a time_block like every absence).
ALTER TABLE absence DROP CONSTRAINT absence_kind_check;
ALTER TABLE absence ADD CONSTRAINT absence_kind_check CHECK (kind IN ('vacation', 'sick', 'training', 'other', 'note'));
ALTER TABLE absence ADD COLUMN blocks boolean NOT NULL DEFAULT true;
ALTER TABLE absence ADD CONSTRAINT absence_only_notes_free CHECK (kind = 'note' OR blocks);
ALTER TABLE absence ADD CONSTRAINT absence_note_text CHECK (kind <> 'note' OR length(note) > 0);
