-- Owner request 2026-11-10 (D-054): delete staff profiles (with confirmation).
-- A person without any history is removed completely. A person with past appointments, absences
-- or entries keeps only the display name on the stylist row (past appointments stay in the
-- history); the login is removed: e-mail, user name and password are cleared, sessions end.
-- Upcoming appointments of the person are no longer confirmed: they become "Rücksprache" with
-- needs_reassign = true and wait in the requests inbox until staff give them to a colleague
-- (then confirm) or decline them.
ALTER TABLE stylist ADD COLUMN deleted_at timestamptz;
ALTER TABLE staff_user ADD COLUMN deleted_at timestamptz;
ALTER TABLE appointment ADD COLUMN needs_reassign boolean NOT NULL DEFAULT false;

-- Owner request 2026-11-10 (D-057): the note to the client in the requests inbox is saved first
-- (draft, staff only) and sent with the answer. Kept apart from client_note, which the client sees.
ALTER TABLE appointment ADD COLUMN client_note_draft text CHECK (length(client_note_draft) <= 500);
