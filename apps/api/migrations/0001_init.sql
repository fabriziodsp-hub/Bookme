-- Initial schema (multi-tenant). Times are timestamptz (UTC). See docs/spec.md §5.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE asset (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/webp', 'image/svg+xml', 'image/jpeg')),
  bytes        bytea NOT NULL CHECK (octet_length(bytes) <= 524288),
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per salon. `config` is a SalonConfig validated by @salon/engine before every write.
CREATE TABLE tenant (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name          text NOT NULL,
  profile       jsonb NOT NULL,
  config        jsonb NOT NULL,
  theme         jsonb NOT NULL DEFAULT '{"preset":"dark","accent":"emerald"}',
  logo_asset_id uuid REFERENCES asset(id),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price (
  tenant_id              uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  service_id             text NOT NULL,
  variant                text NOT NULL DEFAULT '',          -- '' = applies to all variants
  price_cents            int NOT NULL CHECK (price_cents >= 0),
  is_from                boolean NOT NULL DEFAULT false,    -- "ab 45 €"
  finish_surcharge_cents int CHECK (finish_surcharge_cents >= 0),
  PRIMARY KEY (tenant_id, service_id, variant)
);

CREATE TABLE stylist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  color        text NOT NULL DEFAULT '#34d399',
  active       boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE staff_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenant(id) ON DELETE CASCADE,
  stylist_id    uuid REFERENCES stylist(id),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('platform_admin', 'owner', 'stylist')),
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'platform_admin') = (tenant_id IS NULL))
);

CREATE TABLE session (
  id_hash       text PRIMARY KEY,           -- sha256 of the cookie token
  staff_user_id uuid NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_expires_idx ON session (expires_at);

CREATE TABLE customer (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  first_name                text NOT NULL,
  last_name                 text NOT NULL,
  phone                     text,
  email                     text,
  birth_month               smallint CHECK (birth_month BETWEEN 1 AND 12),   -- only with consent
  birthday_consent_at       timestamptz,
  marketing_unsubscribed_at timestamptz,
  unsubscribe_token_hash    text UNIQUE,
  anonymized_at             timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (anonymized_at IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL),
  CHECK (birth_month IS NULL OR birthday_consent_at IS NOT NULL),
  UNIQUE (tenant_id, id)
);
CREATE INDEX customer_search_idx ON customer (tenant_id, lower(last_name), lower(first_name));
CREATE INDEX customer_email_idx ON customer (tenant_id, lower(email));
CREATE INDEX customer_phone_idx ON customer (tenant_id, phone);

CREATE TABLE appointment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  ref_code             text NOT NULL,
  stylist_id           uuid NOT NULL,
  customer_id          uuid NOT NULL,
  service_id           text NOT NULL,
  audience             text NOT NULL CHECK (audience IN ('women', 'men')),
  variant              text,
  finish               boolean NOT NULL DEFAULT false,
  adult_declared       boolean NOT NULL,
  color_notes          text CHECK (length(color_notes) <= 500),
  internal_note        text CHECK (length(internal_note) <= 2000),
  status               text NOT NULL DEFAULT 'requested'
                       CHECK (status IN ('requested', 'discuss', 'confirmed', 'declined', 'expired', 'completed', 'no_show', 'cancelled')),
  source               text NOT NULL CHECK (source IN ('online', 'staff')),
  manage_token_hash    text UNIQUE,
  age_check_status     text NOT NULL DEFAULT 'not_required'
                       CHECK (age_check_status IN ('not_required', 'open', 'requested', 'verified', 'not_verified', 'not_presented')),
  age_check_at         timestamptz,
  age_check_by         uuid REFERENCES staff_user(id),
  fee_cents            int,                 -- copied from the fee rule at booking
  fee_late_cancel_hours int,
  fee_consent_at       timestamptz,
  fee_consent_text     text,
  fee_status           text NOT NULL DEFAULT 'none' CHECK (fee_status IN ('none', 'due', 'paid', 'waived')),
  birthday_discount    boolean NOT NULL DEFAULT false,
  price_cents_snapshot int,
  price_is_from        boolean NOT NULL DEFAULT false,
  expires_at           timestamptz,         -- for requested
  last_digest_at       timestamptz,
  decline_reason       text,
  start_at             timestamptz NOT NULL,
  end_at               timestamptz NOT NULL CHECK (end_at > start_at),
  version              int NOT NULL DEFAULT 1,
  cancel_reason        text,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ref_code),
  UNIQUE (tenant_id, id),
  -- Composite FKs: an appointment can only reference stylists/customers of its own salon.
  FOREIGN KEY (tenant_id, stylist_id) REFERENCES stylist (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id),
  CHECK (fee_cents IS NULL OR fee_consent_at IS NOT NULL)
);
CREATE INDEX appointment_range_idx ON appointment (tenant_id, start_at);
CREATE INDEX appointment_customer_idx ON appointment (customer_id, start_at DESC);
CREATE INDEX appointment_open_idx ON appointment (tenant_id, status) WHERE status IN ('requested', 'discuss');

CREATE TABLE birthday_redemption (
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  year           int NOT NULL,
  appointment_id uuid NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, customer_id, year)
);

CREATE TABLE absence (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  stylist_id uuid NOT NULL,
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL CHECK (end_at > start_at),
  kind       text NOT NULL CHECK (kind IN ('vacation', 'sick', 'training', 'other')),
  note       text CHECK (length(note) <= 500),
  created_by uuid REFERENCES staff_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, stylist_id) REFERENCES stylist (tenant_id, id)
);

-- One row per appointment phase or absence. The exclusion constraint makes overlapping
-- busy time for the same stylist impossible at the database level.
CREATE TABLE time_block (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  stylist_id     uuid NOT NULL,
  appointment_id uuid REFERENCES appointment(id) ON DELETE CASCADE,
  absence_id     uuid REFERENCES absence(id) ON DELETE CASCADE,
  seq            int NOT NULL DEFAULT 0,
  phase_key      text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('busy', 'free')),
  active         boolean NOT NULL DEFAULT true,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL CHECK (end_at > start_at),
  CHECK ((appointment_id IS NULL) <> (absence_id IS NULL)),
  FOREIGN KEY (tenant_id, stylist_id) REFERENCES stylist (tenant_id, id),
  CONSTRAINT time_block_no_overlap EXCLUDE USING gist (
    stylist_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (kind = 'busy' AND active)
);
CREATE INDEX time_block_range_idx ON time_block USING gist (stylist_id, tstzrange(start_at, end_at, '[)'));
CREATE INDEX time_block_appointment_idx ON time_block (appointment_id);

CREATE TABLE appointment_event (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  actor          text NOT NULL,             -- 'customer' | 'staff:<uuid>' | 'system'
  type           text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX appointment_event_idx ON appointment_event (appointment_id, at);

CREATE TABLE outbox_message (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES appointment(id) ON DELETE SET NULL,
  channel        text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient      text NOT NULL,
  template       text NOT NULL,
  subject        text NOT NULL,
  body           text NOT NULL,
  attachments    jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  dedupe_key     text,
  send_after     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_message (status, send_after);
-- e.g. one reminder per appointment and channel, one birthday mail per customer and year.
CREATE UNIQUE INDEX outbox_dedupe ON outbox_message (channel, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE idempotency_key (
  key          text NOT NULL,
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  status_code  int,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
