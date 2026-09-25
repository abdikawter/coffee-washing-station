-- =============================================================================
-- 0005_lots_and_wet_processing
-- Lots, lot events, hopper/flotation, reconciliation, pulping, fermentation, washing, grading.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE lots (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_number                 text NOT NULL,
  type                       lot_type NOT NULL,
  supplier_id                uuid,
  purchase_voucher_id        uuid,
  parent_lot_id              uuid,
  original_cherry_weight_kg  numeric(12,3) NOT NULL,  -- child lots copy the ROOT lot value (not apportioned); outturn is computed from the root
  current_weight_kg          numeric(12,3) NOT NULL,
  processing_date            date NOT NULL,
  current_stage              lot_stage NOT NULL DEFAULT 'PURCHASED',
  current_location           text,
  grade_id                   uuid,
  status                     lot_status NOT NULL DEFAULT 'ACTIVE',
  qr_token                   text NOT NULL,
  version                    integer NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lots_pkey PRIMARY KEY (id),
  CONSTRAINT lots_lot_number_key UNIQUE (lot_number),
  CONSTRAINT lots_purchase_voucher_id_key UNIQUE (purchase_voucher_id),
  CONSTRAINT lots_qr_token_key UNIQUE (qr_token)
);
CREATE INDEX lots_processing_date_idx ON lots (processing_date);
CREATE INDEX lots_current_stage_status_idx ON lots (current_stage, status);
CREATE INDEX lots_supplier_id_idx ON lots (supplier_id);
CREATE INDEX lots_parent_lot_id_idx ON lots (parent_lot_id);
CREATE INDEX lots_grade_id_idx ON lots (grade_id);

CREATE TABLE lot_events (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id                     uuid NOT NULL,
  sequence                   integer NOT NULL,
  event_type                 lot_event_type NOT NULL,
  stage                      lot_stage NOT NULL,
  occurred_at                timestamptz NOT NULL,
  user_id                    uuid NOT NULL,
  quantity_kg                numeric(12,3),
  ref_type                   text NOT NULL,  -- e.g. "HopperRecord"
  ref_id                     uuid NOT NULL,
  location                   text,
  payload                    jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lot_events_pkey PRIMARY KEY (id),
  CONSTRAINT lot_events_lot_id_sequence_key UNIQUE (lot_id, sequence)
);
CREATE INDEX lot_events_lot_id_occurred_at_idx ON lot_events (lot_id, occurred_at);
CREATE INDEX lot_events_event_type_occurred_at_idx ON lot_events (event_type, occurred_at);
CREATE INDEX lot_events_ref_type_ref_id_idx ON lot_events (ref_type, ref_id);

CREATE TABLE hoppers (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id               uuid NOT NULL,
  capacity_kg                numeric(12,3) NOT NULL,
  CONSTRAINT hoppers_pkey PRIMARY KEY (id),
  CONSTRAINT hoppers_equipment_id_key UNIQUE (equipment_id)
);

CREATE TABLE hopper_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  hopper_id                  uuid NOT NULL,
  lot_id                     uuid NOT NULL,
  intake_at                  timestamptz NOT NULL,
  purchased_cherry_kg        numeric(12,3) NOT NULL,  -- snapshot of lot purchased weight
  intake_kg                  numeric(12,3) NOT NULL,
  floaters_kg                numeric(12,3),
  sinkers_kg                 numeric(12,3),
  flotation_at               timestamptz,
  operator_id                uuid NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hopper_records_pkey PRIMARY KEY (id),
  CONSTRAINT hopper_records_lot_id_key UNIQUE (lot_id)
);
CREATE INDEX hopper_records_intake_at_idx ON hopper_records (intake_at);

CREATE TABLE hopper_reconciliations (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  recon_date                 date NOT NULL,
  purchased_cherry_kg        numeric(12,3) NOT NULL,
  hopper_intake_kg           numeric(12,3) NOT NULL,
  difference_kg              numeric(12,3) NOT NULL,
  difference_pct             numeric(7,3) NOT NULL,
  tolerance_pct              numeric(5,2) NOT NULL,  -- snapshot
  status                     reconciliation_status NOT NULL,
  reviewed_by_id             uuid,
  reviewed_at                timestamptz,
  review_notes               text,
  detail                     jsonb NOT NULL,  -- per-lot breakdown
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hopper_reconciliations_pkey PRIMARY KEY (id),
  CONSTRAINT hopper_reconciliations_recon_date_key UNIQUE (recon_date)
);
CREATE INDEX hopper_reconciliations_status_idx ON hopper_reconciliations (status);

CREATE TABLE pulping_machines (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id               uuid NOT NULL,
  CONSTRAINT pulping_machines_pkey PRIMARY KEY (id),
  CONSTRAINT pulping_machines_equipment_id_key UNIQUE (equipment_id)
);

CREATE TABLE pulping_machine_inspections (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  machine_id                 uuid NOT NULL,
  inspection_date            date NOT NULL,
  inspected_at               timestamptz NOT NULL,
  disc_teeth_ok              boolean NOT NULL,
  disc_spacing_ok            boolean NOT NULL,
  disc_spacing_mm            numeric(6,2),
  cleaning_done              boolean NOT NULL,
  result                     check_result NOT NULL,
  inspector_id               uuid NOT NULL,
  notes                      text,
  CONSTRAINT pulping_machine_inspections_pkey PRIMARY KEY (id),
  CONSTRAINT pulping_machine_inspections_machine_id_inspection_date_key UNIQUE (machine_id, inspection_date)
);

CREATE TABLE pulping_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id                     uuid NOT NULL,
  machine_id                 uuid NOT NULL,
  started_at                 timestamptz NOT NULL,
  ended_at                   timestamptz,
  input_kg                   numeric(12,3) NOT NULL,
  output_kg                  numeric(12,3),
  operator_id                uuid NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pulping_records_pkey PRIMARY KEY (id)
);
CREATE INDEX pulping_records_lot_id_idx ON pulping_records (lot_id);
CREATE INDEX pulping_records_started_at_idx ON pulping_records (started_at);

CREATE TABLE fermentation_tanks (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id               uuid NOT NULL,
  capacity_kg                numeric(12,3) NOT NULL,
  CONSTRAINT fermentation_tanks_pkey PRIMARY KEY (id),
  CONSTRAINT fermentation_tanks_equipment_id_key UNIQUE (equipment_id)
);

CREATE TABLE fermentation_batches (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_number               text NOT NULL,
  lot_id                     uuid NOT NULL,
  tank_id                    uuid NOT NULL,
  input_kg                   numeric(12,3) NOT NULL,
  start_at                   timestamptz NOT NULL,
  expected_duration_hours    numeric(5,1) NOT NULL,
  min_duration_hours         numeric(5,1) NOT NULL,  -- snapshot of setting
  max_duration_hours         numeric(5,1) NOT NULL,  -- snapshot of setting
  end_at                     timestamptz,
  mucilage_assessment        mucilage_assessment NOT NULL DEFAULT 'NOT_ASSESSED',
  status                     fermentation_status NOT NULL DEFAULT 'IN_PROGRESS',
  operator_id                uuid NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fermentation_batches_pkey PRIMARY KEY (id),
  CONSTRAINT fermentation_batches_batch_number_key UNIQUE (batch_number)
);
CREATE INDEX fermentation_batches_lot_id_idx ON fermentation_batches (lot_id);
CREATE INDEX fermentation_batches_status_start_at_idx ON fermentation_batches (status, start_at);

CREATE TABLE fermentation_measurements (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id                   uuid NOT NULL,
  measured_at                timestamptz NOT NULL,
  temperature_c              numeric(5,2),
  ph                         numeric(4,2),
  sweetness                  numeric(6,2),  -- scale defined by setting
  acidity                    numeric(6,2),  -- scale defined by setting
  mucilage_assessment        mucilage_assessment NOT NULL DEFAULT 'NOT_ASSESSED',
  measured_by_id             uuid NOT NULL,
  notes                      text,
  CONSTRAINT fermentation_measurements_pkey PRIMARY KEY (id)
);
CREATE INDEX fermentation_measurements_batch_id_measured_at_idx ON fermentation_measurements (batch_id, measured_at);

CREATE TABLE washing_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id                     uuid NOT NULL,
  washed_at                  timestamptz NOT NULL,
  input_kg                   numeric(12,3) NOT NULL,
  output_kg                  numeric(12,3) NOT NULL,
  density_separation         text,
  operator_id                uuid NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT washing_records_pkey PRIMARY KEY (id)
);
CREATE INDEX washing_records_lot_id_idx ON washing_records (lot_id);
CREATE INDEX washing_records_washed_at_idx ON washing_records (washed_at);

CREATE TABLE grading_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  washing_record_id          uuid NOT NULL,
  lot_id                     uuid NOT NULL,  -- the parent (pre-grade) lot
  graded_at                  timestamptz NOT NULL,
  graded_by_id               uuid NOT NULL,
  total_output_kg            numeric(12,3) NOT NULL,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grading_records_pkey PRIMARY KEY (id),
  CONSTRAINT grading_records_lot_id_key UNIQUE (lot_id)
);
CREATE INDEX grading_records_graded_at_idx ON grading_records (graded_at);

CREATE TABLE grade_outputs (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  grading_record_id          uuid NOT NULL,
  grade_id                   uuid NOT NULL,
  weight_kg                  numeric(12,3) NOT NULL,
  child_lot_id               uuid NOT NULL,
  CONSTRAINT grade_outputs_pkey PRIMARY KEY (id),
  CONSTRAINT grade_outputs_child_lot_id_key UNIQUE (child_lot_id),
  CONSTRAINT grade_outputs_grading_record_id_grade_id_key UNIQUE (grading_record_id, grade_id)
);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE lots ADD CONSTRAINT lots_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT;
ALTER TABLE lots ADD CONSTRAINT lots_purchase_voucher_id_fkey
  FOREIGN KEY (purchase_voucher_id) REFERENCES purchase_vouchers (id) ON DELETE RESTRICT;
ALTER TABLE lots ADD CONSTRAINT lots_parent_lot_id_fkey
  FOREIGN KEY (parent_lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE lots ADD CONSTRAINT lots_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE quality_holds ADD CONSTRAINT quality_holds_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE lot_events ADD CONSTRAINT lot_events_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE lot_events ADD CONSTRAINT lot_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE hoppers ADD CONSTRAINT hoppers_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT;
ALTER TABLE hopper_records ADD CONSTRAINT hopper_records_hopper_id_fkey
  FOREIGN KEY (hopper_id) REFERENCES hoppers (id) ON DELETE RESTRICT;
ALTER TABLE hopper_records ADD CONSTRAINT hopper_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE hopper_records ADD CONSTRAINT hopper_records_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE hopper_reconciliations ADD CONSTRAINT hopper_reconciliations_reviewed_by_id_fkey
  FOREIGN KEY (reviewed_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE pulping_machines ADD CONSTRAINT pulping_machines_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT;
ALTER TABLE pulping_machine_inspections ADD CONSTRAINT pulping_machine_inspections_machine_id_fkey
  FOREIGN KEY (machine_id) REFERENCES pulping_machines (id) ON DELETE RESTRICT;
ALTER TABLE pulping_machine_inspections ADD CONSTRAINT pulping_machine_inspections_inspector_id_fkey
  FOREIGN KEY (inspector_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE pulping_records ADD CONSTRAINT pulping_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE pulping_records ADD CONSTRAINT pulping_records_machine_id_fkey
  FOREIGN KEY (machine_id) REFERENCES pulping_machines (id) ON DELETE RESTRICT;
ALTER TABLE pulping_records ADD CONSTRAINT pulping_records_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE fermentation_tanks ADD CONSTRAINT fermentation_tanks_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT;
ALTER TABLE fermentation_batches ADD CONSTRAINT fermentation_batches_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE fermentation_batches ADD CONSTRAINT fermentation_batches_tank_id_fkey
  FOREIGN KEY (tank_id) REFERENCES fermentation_tanks (id) ON DELETE RESTRICT;
ALTER TABLE fermentation_batches ADD CONSTRAINT fermentation_batches_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE fermentation_measurements ADD CONSTRAINT fermentation_measurements_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES fermentation_batches (id) ON DELETE CASCADE;
ALTER TABLE fermentation_measurements ADD CONSTRAINT fermentation_measurements_measured_by_id_fkey
  FOREIGN KEY (measured_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE washing_records ADD CONSTRAINT washing_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE washing_records ADD CONSTRAINT washing_records_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE grading_records ADD CONSTRAINT grading_records_washing_record_id_fkey
  FOREIGN KEY (washing_record_id) REFERENCES washing_records (id) ON DELETE RESTRICT;
ALTER TABLE grading_records ADD CONSTRAINT grading_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE grading_records ADD CONSTRAINT grading_records_graded_by_id_fkey
  FOREIGN KEY (graded_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE grade_outputs ADD CONSTRAINT grade_outputs_grading_record_id_fkey
  FOREIGN KEY (grading_record_id) REFERENCES grading_records (id) ON DELETE RESTRICT;
ALTER TABLE grade_outputs ADD CONSTRAINT grade_outputs_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE grade_outputs ADD CONSTRAINT grade_outputs_child_lot_id_fkey
  FOREIGN KEY (child_lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
