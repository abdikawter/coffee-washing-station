-- =============================================================================
-- 0002_identity_and_system
-- Users, roles, permissions, refresh tokens, employees, settings, document sequences, documents, outbox.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE users (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  username                   text NOT NULL,
  email                      text,
  full_name                  text NOT NULL,
  phone                      text,
  password_hash              text NOT NULL,
  status                     user_status NOT NULL DEFAULT 'ACTIVE',
  must_change_password       boolean NOT NULL DEFAULT true,
  failed_login_count         integer NOT NULL DEFAULT 0,
  locked_until               timestamptz,
  last_login_at              timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_email_key UNIQUE (email)
);
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE roles (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,  -- SUPER_ADMIN, SITE_MANAGER, ...
  name                       text NOT NULL,
  description                text,
  is_system                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_pkey PRIMARY KEY (id),
  CONSTRAINT roles_code_key UNIQUE (code)
);

CREATE TABLE permissions (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,  -- e.g. "purchase:approve"
  module                     text NOT NULL,
  action                     text NOT NULL,
  description                text,
  CONSTRAINT permissions_pkey PRIMARY KEY (id),
  CONSTRAINT permissions_code_key UNIQUE (code)
);
CREATE INDEX permissions_module_idx ON permissions (module);

CREATE TABLE role_permissions (
  role_id                    uuid NOT NULL,
  permission_id              uuid NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id                    uuid NOT NULL,
  role_id                    uuid NOT NULL,
  assigned_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL,
  family_id                  uuid NOT NULL,  -- rotation family for reuse detection
  token_hash                 text NOT NULL,
  expires_at                 timestamptz NOT NULL,
  revoked_at                 timestamptz,
  replaced_by                uuid,
  ip_address                 text,
  user_agent                 text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash)
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);

CREATE TABLE employees (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_no                text NOT NULL,
  full_name                  text NOT NULL,
  position                   text NOT NULL,
  department                 department NOT NULL,
  phone                      text,
  user_id                    uuid,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_pkey PRIMARY KEY (id),
  CONSTRAINT employees_employee_no_key UNIQUE (employee_no),
  CONSTRAINT employees_user_id_key UNIQUE (user_id)
);

CREATE TABLE system_settings (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  key                        text NOT NULL,  -- e.g. "moisture.targetMaxPct"
  category                   text NOT NULL,
  value                      jsonb NOT NULL,
  value_type                 setting_value_type NOT NULL,
  description                text NOT NULL,
  source                     text NOT NULL,  -- "MANUAL" (stated in manual) | "PROVISIONAL" (engineering default, must be confirmed) | "UNSET" (must be configured)
  version                    integer NOT NULL DEFAULT 1,
  updated_by_id              uuid,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_settings_pkey PRIMARY KEY (id),
  CONSTRAINT system_settings_key_key UNIQUE (key)
);
CREATE INDEX system_settings_category_idx ON system_settings (category);

CREATE TABLE document_sequences (
  key                        text NOT NULL,  -- e.g. "PV:2026"
  prefix                     text NOT NULL,
  last_value                 integer NOT NULL DEFAULT 0,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_sequences_pkey PRIMARY KEY (key)
);

CREATE TABLE documents (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  category                   document_category NOT NULL,
  provider                   storage_provider NOT NULL,
  storage_key                text NOT NULL,
  original_name              text NOT NULL,
  mime_type                  text NOT NULL,
  size_bytes                 integer NOT NULL,
  sha256                     text NOT NULL,
  entity_type                text,
  entity_id                  uuid,
  uploaded_by_id             uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_storage_key_key UNIQUE (storage_key)
);
CREATE INDEX documents_entity_type_entity_id_idx ON documents (entity_type, entity_id);
CREATE INDEX documents_category_idx ON documents (category);

CREATE TABLE outbox_events (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type                 text NOT NULL,  -- e.g. "fermentation.started"
  aggregate                  text NOT NULL,
  aggregate_id               uuid NOT NULL,
  payload                    jsonb NOT NULL,
  status                     outbox_status NOT NULL DEFAULT 'PENDING',
  attempts                   integer NOT NULL DEFAULT 0,
  last_error                 text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  processed_at               timestamptz,
  CONSTRAINT outbox_events_pkey PRIMARY KEY (id)
);
CREATE INDEX outbox_events_status_created_at_idx ON outbox_events (status, created_at);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_id_fkey
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_permission_id_fkey
  FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_id_fkey
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT;
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE employees ADD CONSTRAINT employees_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_updated_by_id_fkey
  FOREIGN KEY (updated_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE documents ADD CONSTRAINT documents_uploaded_by_id_fkey
  FOREIGN KEY (uploaded_by_id) REFERENCES users (id) ON DELETE RESTRICT;
