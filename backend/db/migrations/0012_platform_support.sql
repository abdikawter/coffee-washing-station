-- =============================================================================
-- 0012_platform_support
-- Tables and grants required by the Express + pg + pg-boss stack that the
-- blueprint delegated to Redis or the ORM.
-- =============================================================================

-- Idempotency keys (ARCHITECTURE.md §8). Previously Redis with a 24 h TTL;
-- now PostgreSQL, purged daily by the pg-boss job "maintenance.purge-idempotency-keys".
CREATE TABLE idempotency_keys (
  user_id         uuid        NOT NULL,
  route           text        NOT NULL,   -- "POST /api/v1/payments"
  key             text        NOT NULL,   -- client-supplied Idempotency-Key header
  request_hash    text        NOT NULL,   -- sha256 of the request body; reuse with a different body = 422
  status          text        NOT NULL DEFAULT 'IN_PROGRESS',
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (user_id, route, key),
  CONSTRAINT idempotency_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_idem_status CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  CONSTRAINT ck_idem_key_len CHECK (length(key) BETWEEN 8 AND 200)
);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);

CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);

-- Optional least-privilege application role (ARCHITECTURE.md §6.4 / §14).
-- If a role named "cws_app" exists (created by db/roles.sql), grant it DML on
-- everything but INSERT/SELECT only on the four ledgers. When it does not exist
-- (e.g. a single-user Render database) this block is a no-op and the append-only
-- triggers from 0011 remain the enforcement.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cws_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO cws_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cws_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cws_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, lot_events, inventory_transactions, cash_transactions FROM cws_app';
    EXECUTE 'REVOKE ALL ON schema_migrations FROM cws_app';
    EXECUTE 'GRANT SELECT ON schema_migrations TO cws_app';
  END IF;
END $$;
