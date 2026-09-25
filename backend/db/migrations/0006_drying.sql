-- =============================================================================
-- 0006_drying
-- Drying beds, batches, bed assignments, moisture, raking, defects.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE drying_beds (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  bed_code                   text NOT NULL,  -- unique visible ID painted on bed
  location                   text NOT NULL,
  capacity_kg                numeric(12,3) NOT NULL,
  status                     drying_bed_status NOT NULL DEFAULT 'AVAILABLE',
  qr_token                   text NOT NULL,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drying_beds_pkey PRIMARY KEY (id),
  CONSTRAINT drying_beds_bed_code_key UNIQUE (bed_code),
  CONSTRAINT drying_beds_qr_token_key UNIQUE (qr_token)
);
CREATE INDEX drying_beds_status_idx ON drying_beds (status);

CREATE TABLE moisture_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id                     uuid NOT NULL,
  batch_id                   uuid NOT NULL,
  bed_id                     uuid NOT NULL,
  measured_at                timestamptz NOT NULL,
  moisture_pct               numeric(5,2) NOT NULL,
  device_id                  uuid,  -- Equipment of type MOISTURE_METER
  status                     moisture_status NOT NULL,  -- computed against settings at time of reading
  target_min_pct             numeric(5,2) NOT NULL,  -- snapshot
  target_max_pct             numeric(5,2) NOT NULL,  -- snapshot
  is_final_verification      boolean NOT NULL DEFAULT false,
  measured_by_id             uuid NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moisture_records_pkey PRIMARY KEY (id)
);
CREATE INDEX moisture_records_batch_id_measured_at_idx ON moisture_records (batch_id, measured_at);
CREATE INDEX moisture_records_bed_id_measured_at_idx ON moisture_records (bed_id, measured_at);
CREATE INDEX moisture_records_lot_id_idx ON moisture_records (lot_id);
CREATE INDEX moisture_records_status_idx ON moisture_records (status);

CREATE TABLE drying_batches (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_number               text NOT NULL,
  lot_id                     uuid NOT NULL,
  grade_id                   uuid NOT NULL,
  initial_weight_kg          numeric(12,3) NOT NULL,
  final_weight_kg            numeric(12,3),
  loaded_at                  timestamptz NOT NULL,
  start_drying_at            timestamptz,
  end_drying_at              timestamptz,
  current_moisture_pct       numeric(5,2),
  final_moisture_pct         numeric(5,2),
  final_moisture_rec_id      uuid,
  final_verified_by_id       uuid,
  final_verified_at          timestamptz,
  status                     drying_batch_status NOT NULL DEFAULT 'LOADING',
  supervisor_id              uuid NOT NULL,
  qr_token                   text NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drying_batches_pkey PRIMARY KEY (id),
  CONSTRAINT drying_batches_batch_number_key UNIQUE (batch_number),
  CONSTRAINT drying_batches_final_moisture_rec_id_key UNIQUE (final_moisture_rec_id),
  CONSTRAINT drying_batches_qr_token_key UNIQUE (qr_token)
);
CREATE INDEX drying_batches_lot_id_idx ON drying_batches (lot_id);
CREATE INDEX drying_batches_status_idx ON drying_batches (status);

CREATE TABLE drying_batch_beds (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id                   uuid NOT NULL,
  bed_id                     uuid NOT NULL,
  loaded_kg                  numeric(12,3) NOT NULL,
  loaded_at                  timestamptz NOT NULL,
  unloaded_at                timestamptz,
  CONSTRAINT drying_batch_beds_pkey PRIMARY KEY (id)
);
CREATE INDEX drying_batch_beds_bed_id_idx ON drying_batch_beds (bed_id);
CREATE INDEX drying_batch_beds_batch_id_idx ON drying_batch_beds (batch_id);

CREATE TABLE raking_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  bed_id                     uuid NOT NULL,
  batch_id                   uuid NOT NULL,
  lot_id                     uuid NOT NULL,
  raked_at                   timestamptz NOT NULL,
  worker_id                  uuid NOT NULL,
  supervisor_id              uuid,
  inspection_notes           text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raking_records_pkey PRIMARY KEY (id)
);
CREATE INDEX raking_records_bed_id_raked_at_idx ON raking_records (bed_id, raked_at);
CREATE INDEX raking_records_batch_id_idx ON raking_records (batch_id);

CREATE TABLE defect_types (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,
  name                       text NOT NULL,
  description                text,
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT defect_types_pkey PRIMARY KEY (id),
  CONSTRAINT defect_types_code_key UNIQUE (code)
);

CREATE TABLE defect_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id                     uuid NOT NULL,
  batch_id                   uuid NOT NULL,
  bed_id                     uuid NOT NULL,
  defect_type_id             uuid NOT NULL,
  source                     defect_source NOT NULL,
  recorded_at                timestamptz NOT NULL,
  quantity_kg                numeric(12,3) NOT NULL,
  worker_id                  uuid,
  supervisor_id              uuid NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT defect_records_pkey PRIMARY KEY (id)
);
CREATE INDEX defect_records_lot_id_idx ON defect_records (lot_id);
CREATE INDEX defect_records_batch_id_idx ON defect_records (batch_id);
CREATE INDEX defect_records_recorded_at_idx ON defect_records (recorded_at);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE moisture_records ADD CONSTRAINT moisture_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE moisture_records ADD CONSTRAINT moisture_records_bed_id_fkey
  FOREIGN KEY (bed_id) REFERENCES drying_beds (id) ON DELETE RESTRICT;
ALTER TABLE moisture_records ADD CONSTRAINT moisture_records_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES equipment (id) ON DELETE RESTRICT;
ALTER TABLE moisture_records ADD CONSTRAINT moisture_records_measured_by_id_fkey
  FOREIGN KEY (measured_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE drying_batches ADD CONSTRAINT drying_batches_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE drying_batches ADD CONSTRAINT drying_batches_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE drying_batches ADD CONSTRAINT drying_batches_supervisor_id_fkey
  FOREIGN KEY (supervisor_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE drying_batches ADD CONSTRAINT drying_batches_final_verified_by_id_fkey
  FOREIGN KEY (final_verified_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE drying_batches ADD CONSTRAINT drying_batches_final_moisture_rec_id_fkey
  FOREIGN KEY (final_moisture_rec_id) REFERENCES moisture_records (id) ON DELETE RESTRICT;
ALTER TABLE moisture_records ADD CONSTRAINT moisture_records_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES drying_batches (id) ON DELETE RESTRICT;
ALTER TABLE drying_batch_beds ADD CONSTRAINT drying_batch_beds_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES drying_batches (id) ON DELETE RESTRICT;
ALTER TABLE drying_batch_beds ADD CONSTRAINT drying_batch_beds_bed_id_fkey
  FOREIGN KEY (bed_id) REFERENCES drying_beds (id) ON DELETE RESTRICT;
ALTER TABLE raking_records ADD CONSTRAINT raking_records_bed_id_fkey
  FOREIGN KEY (bed_id) REFERENCES drying_beds (id) ON DELETE RESTRICT;
ALTER TABLE raking_records ADD CONSTRAINT raking_records_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES drying_batches (id) ON DELETE RESTRICT;
ALTER TABLE raking_records ADD CONSTRAINT raking_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE raking_records ADD CONSTRAINT raking_records_supervisor_id_fkey
  FOREIGN KEY (supervisor_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE defect_records ADD CONSTRAINT defect_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE defect_records ADD CONSTRAINT defect_records_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES drying_batches (id) ON DELETE RESTRICT;
ALTER TABLE defect_records ADD CONSTRAINT defect_records_bed_id_fkey
  FOREIGN KEY (bed_id) REFERENCES drying_beds (id) ON DELETE RESTRICT;
ALTER TABLE defect_records ADD CONSTRAINT defect_records_defect_type_id_fkey
  FOREIGN KEY (defect_type_id) REFERENCES defect_types (id) ON DELETE RESTRICT;
ALTER TABLE defect_records ADD CONSTRAINT defect_records_supervisor_id_fkey
  FOREIGN KEY (supervisor_id) REFERENCES users (id) ON DELETE RESTRICT;
