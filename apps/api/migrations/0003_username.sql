-- Owner request 2026-11-10 (D-049): staff can log in with a user name instead of the e-mail.
-- The login page of a salon (/{slug}/team) already identifies the salon, so the user name only
-- has to be unique within the salon. Platform admins (no salon) get their own unique space.
-- The e-mail stays mandatory for every account (password reset, notifications).
ALTER TABLE staff_user ADD COLUMN username text
  CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
CREATE UNIQUE INDEX staff_user_username_tenant_idx ON staff_user (tenant_id, username) WHERE tenant_id IS NOT NULL AND username IS NOT NULL;
CREATE UNIQUE INDEX staff_user_username_platform_idx ON staff_user (username) WHERE tenant_id IS NULL AND username IS NOT NULL;
