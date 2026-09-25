-- =============================================================================
-- Optional least-privilege roles (ARCHITECTURE.md §6.4, §16.4). Run ONCE as the
-- database owner/superuser, before the first migration, where your PostgreSQL
-- host allows creating roles (local, self-hosted, or managed plans that do).
--
--   cws_app       application login: DML only; INSERT/SELECT on the four ledgers
--                 (grants are applied by migration 0012 when this role exists)
--   cws_readonly  for pgAdmin ad-hoc queries and reporting tools
--
-- Migrations and the pg-boss schema creation must then run as the owner role;
-- set the API's DATABASE_URL to cws_app afterwards.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cws_app') THEN
    CREATE ROLE cws_app LOGIN PASSWORD 'change-me';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cws_readonly') THEN
    CREATE ROLE cws_readonly LOGIN PASSWORD 'change-me';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO cws_app, cws_readonly', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO cws_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cws_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cws_readonly;
