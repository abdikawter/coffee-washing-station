-- =============================================================================
-- 0010_controls_notifications_audit_log
-- Audits, corrective actions, notifications, report jobs, audit log.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE audits (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  audit_number               text NOT NULL,
  title                      text NOT NULL,
  areas                      audit_area[] NOT NULL,
  is_unannounced             boolean NOT NULL DEFAULT false,
  scheduled_for              timestamptz NOT NULL,
  started_at                 timestamptz,
  completed_at               timestamptz,
  status                     audit_status NOT NULL DEFAULT 'SCHEDULED',
  lead_auditor_id            uuid NOT NULL,
  summary                    text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audits_pkey PRIMARY KEY (id),
  CONSTRAINT audits_audit_number_key UNIQUE (audit_number)
);
CREATE INDEX audits_scheduled_for_idx ON audits (scheduled_for);
CREATE INDEX audits_status_idx ON audits (status);

CREATE TABLE audit_items (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  audit_id                   uuid NOT NULL,
  area                       audit_area NOT NULL,
  checkpoint                 text NOT NULL,
  expected                   text,
  observed                   text,
  result                     audit_item_result NOT NULL,
  severity                   severity,
  is_finding                 boolean NOT NULL DEFAULT false,
  lot_id                     uuid,
  evidence_doc_id            uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_items_pkey PRIMARY KEY (id)
);
CREATE INDEX audit_items_audit_id_idx ON audit_items (audit_id);

CREATE TABLE corrective_actions (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  ca_number                  text NOT NULL,
  issue                      text NOT NULL,
  source                     corrective_action_source NOT NULL,
  department                 department NOT NULL,
  severity                   severity NOT NULL DEFAULT 'MEDIUM',
  lot_id                     uuid,
  audit_item_id              uuid,
  reconciliation_id          uuid,
  calibration_id             uuid,
  moisture_record_id         uuid,
  defect_record_id           uuid,
  source_ref                 jsonb,  -- other references (inventory txn, etc.)
  is_auto_generated          boolean NOT NULL DEFAULT false,
  raised_by_id               uuid NOT NULL,
  responsible_id             uuid NOT NULL,
  corrective_action          text NOT NULL,
  due_date                   date NOT NULL,
  status                     corrective_action_status NOT NULL DEFAULT 'OPEN',
  resolution                 text,
  resolved_at                timestamptz,
  verified_by_id             uuid,
  verified_at                timestamptz,
  closed_by_id               uuid,
  closed_at                  timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corrective_actions_pkey PRIMARY KEY (id),
  CONSTRAINT corrective_actions_ca_number_key UNIQUE (ca_number)
);
CREATE INDEX corrective_actions_status_due_date_idx ON corrective_actions (status, due_date);
CREATE INDEX corrective_actions_source_idx ON corrective_actions (source);
CREATE INDEX corrective_actions_responsible_id_idx ON corrective_actions (responsible_id);

CREATE TABLE corrective_action_evidence (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  corrective_action_id       uuid NOT NULL,
  document_id                uuid NOT NULL,
  note                       text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corrective_action_evidence_pkey PRIMARY KEY (id)
);

CREATE TABLE notifications (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL,
  type                       notification_type NOT NULL,
  channel                    notification_channel NOT NULL DEFAULT 'IN_APP',
  title                      text NOT NULL,
  body                       text NOT NULL,
  entity_type                text,
  entity_id                  uuid,
  dedupe_key                 text,  -- prevents duplicate alerts for the same condition
  delivery_status            delivery_status NOT NULL DEFAULT 'PENDING',
  read_at                    timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_dedupe_key_key UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_id_read_at_idx ON notifications (user_id, read_at);
CREATE INDEX notifications_type_created_at_idx ON notifications (type, created_at);

CREATE TABLE report_jobs (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  report_type                text NOT NULL,
  format                     report_format NOT NULL,
  params                     jsonb NOT NULL,
  status                     job_status NOT NULL DEFAULT 'QUEUED',
  document_id                uuid,
  error                      text,
  requested_by_id            uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  completed_at               timestamptz,
  CONSTRAINT report_jobs_pkey PRIMARY KEY (id)
);
CREATE INDEX report_jobs_requested_by_id_created_at_idx ON report_jobs (requested_by_id, created_at);

CREATE TABLE audit_logs (
  id                         bigint GENERATED ALWAYS AS IDENTITY,
  user_id                    uuid,  -- null for system jobs / failed logins with unknown user
  action                     audit_action NOT NULL,
  module                     text NOT NULL,
  entity_type                text NOT NULL,
  entity_id                  text,
  previous_value             jsonb,
  new_value                  jsonb,
  ip_address                 text,
  user_agent                 text,
  request_id                 text,
  prev_hash                  text,
  hash                       text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX audit_logs_entity_type_entity_id_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_id_created_at_idx ON audit_logs (user_id, created_at);
CREATE INDEX audit_logs_module_created_at_idx ON audit_logs (module, created_at);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE audits ADD CONSTRAINT audits_lead_auditor_id_fkey
  FOREIGN KEY (lead_auditor_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE audit_items ADD CONSTRAINT audit_items_audit_id_fkey
  FOREIGN KEY (audit_id) REFERENCES audits (id) ON DELETE CASCADE;
ALTER TABLE audit_items ADD CONSTRAINT audit_items_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE audit_items ADD CONSTRAINT audit_items_evidence_doc_id_fkey
  FOREIGN KEY (evidence_doc_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_audit_item_id_fkey
  FOREIGN KEY (audit_item_id) REFERENCES audit_items (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_reconciliation_id_fkey
  FOREIGN KEY (reconciliation_id) REFERENCES hopper_reconciliations (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_calibration_id_fkey
  FOREIGN KEY (calibration_id) REFERENCES scale_calibrations (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_moisture_record_id_fkey
  FOREIGN KEY (moisture_record_id) REFERENCES moisture_records (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_defect_record_id_fkey
  FOREIGN KEY (defect_record_id) REFERENCES defect_records (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_raised_by_id_fkey
  FOREIGN KEY (raised_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_responsible_id_fkey
  FOREIGN KEY (responsible_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_verified_by_id_fkey
  FOREIGN KEY (verified_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_closed_by_id_fkey
  FOREIGN KEY (closed_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE corrective_action_evidence ADD CONSTRAINT corrective_action_evidence_corrective_action_id_fkey
  FOREIGN KEY (corrective_action_id) REFERENCES corrective_actions (id) ON DELETE CASCADE;
ALTER TABLE corrective_action_evidence ADD CONSTRAINT corrective_action_evidence_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE report_jobs ADD CONSTRAINT report_jobs_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE report_jobs ADD CONSTRAINT report_jobs_requested_by_id_fkey
  FOREIGN KEY (requested_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
