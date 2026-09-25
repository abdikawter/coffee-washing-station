-- =============================================================================
-- 0003_suppliers_equipment_quality
-- Suppliers, equipment, scales & calibration, maintenance, coffee types/grades, quality rules, inspections, holds.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE suppliers (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  supplier_code              text NOT NULL,  -- Farmer/Supplier ID
  full_name                  text NOT NULL,
  phone                      text,
  village                    text,
  address                    text,
  identification_type        identification_type,
  identification_no          text,
  status                     supplier_status NOT NULL DEFAULT 'ACTIVE',
  status_reason              text,
  qr_token                   text NOT NULL,
  registered_by_id           uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_pkey PRIMARY KEY (id),
  CONSTRAINT suppliers_supplier_code_key UNIQUE (supplier_code),
  CONSTRAINT suppliers_qr_token_key UNIQUE (qr_token),
  CONSTRAINT suppliers_identification_type_identification_no_key UNIQUE (identification_type, identification_no)
);
CREATE INDEX suppliers_full_name_idx ON suppliers (full_name);
CREATE INDEX suppliers_phone_idx ON suppliers (phone);
CREATE INDEX suppliers_status_idx ON suppliers (status);

CREATE TABLE supplier_documents (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  supplier_id                uuid NOT NULL,
  document_id                uuid NOT NULL,
  doc_type                   text NOT NULL,  -- configurable label, e.g. "ID card"
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_documents_pkey PRIMARY KEY (id)
);
CREATE INDEX supplier_documents_supplier_id_idx ON supplier_documents (supplier_id);

CREATE TABLE equipment (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,
  name                       text NOT NULL,
  type                       equipment_type NOT NULL,
  status                     equipment_status NOT NULL DEFAULT 'OPERATIONAL',
  location                   text,
  serial_no                  text,
  responsible_employee_id    uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_pkey PRIMARY KEY (id),
  CONSTRAINT equipment_code_key UNIQUE (code)
);
CREATE INDEX equipment_type_status_idx ON equipment (type, status);

CREATE TABLE maintenance_schedules (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id               uuid NOT NULL,
  type                       maintenance_type NOT NULL,
  interval_days              integer NOT NULL,
  last_performed_at          timestamptz,
  next_due_at                timestamptz NOT NULL,
  responsible_employee_id    uuid,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_schedules_pkey PRIMARY KEY (id)
);
CREATE INDEX maintenance_schedules_next_due_at_idx ON maintenance_schedules (next_due_at);

CREATE TABLE machine_maintenance (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id               uuid NOT NULL,
  type                       maintenance_type NOT NULL,
  performed_at               timestamptz NOT NULL,
  performed_by_id            uuid NOT NULL,
  description                text NOT NULL,
  result                     check_result,
  cost                       numeric(14,2),
  next_due_at                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT machine_maintenance_pkey PRIMARY KEY (id)
);
CREATE INDEX machine_maintenance_equipment_id_performed_at_idx ON machine_maintenance (equipment_id, performed_at);

CREATE TABLE scales (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id               uuid NOT NULL,
  capacity_kg                numeric(12,3) NOT NULL,
  readability_kg             numeric(12,3),
  last_verified_at           timestamptz,
  last_result                check_result,
  CONSTRAINT scales_pkey PRIMARY KEY (id),
  CONSTRAINT scales_equipment_id_key UNIQUE (equipment_id)
);

CREATE TABLE scale_calibrations (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  scale_id                   uuid NOT NULL,
  type                       calibration_type NOT NULL,
  calibrated_at              timestamptz NOT NULL,
  standard_weight_kg         numeric(12,3) NOT NULL,
  reading_kg                 numeric(12,3) NOT NULL,
  deviation_kg               numeric(12,3) NOT NULL,
  tolerance_kg               numeric(12,3) NOT NULL,  -- snapshot of setting at time of check
  result                     check_result NOT NULL,
  performed_by_id            uuid NOT NULL,
  certificate_doc_id         uuid,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scale_calibrations_pkey PRIMARY KEY (id)
);
CREATE INDEX scale_calibrations_scale_id_calibrated_at_idx ON scale_calibrations (scale_id, calibrated_at);

CREATE TABLE coffee_types (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,
  name                       text NOT NULL,
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT coffee_types_pkey PRIMARY KEY (id),
  CONSTRAINT coffee_types_code_key UNIQUE (code)
);

CREATE TABLE coffee_grades (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,  -- e.g. "G1", "G2"
  name                       text NOT NULL,
  stage                      grade_stage NOT NULL,
  sort_order                 integer NOT NULL DEFAULT 0,
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT coffee_grades_pkey PRIMARY KEY (id),
  CONSTRAINT coffee_grades_stage_code_key UNIQUE (stage, code)
);

CREATE TABLE quality_settings (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  metric                     quality_metric NOT NULL,
  operator                   comparison_operator NOT NULL,
  threshold                  numeric(5,2) NOT NULL,
  action                     quality_rule_action NOT NULL,
  is_active                  boolean NOT NULL DEFAULT true,
  description                text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_settings_pkey PRIMARY KEY (id)
);

CREATE TABLE quality_inspections (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  inspection_no              text NOT NULL,
  supplier_id                uuid NOT NULL,
  inspector_id               uuid NOT NULL,
  inspected_at               timestamptz NOT NULL,
  red_ripe_pct               numeric(5,2) NOT NULL,
  green_unripe_pct           numeric(5,2) NOT NULL,
  overripe_damaged_pct       numeric(5,2) NOT NULL,
  quality_grade_id           uuid,
  decision                   quality_decision NOT NULL,
  rejection_reason           text,
  rule_evaluation            jsonb NOT NULL,  -- snapshot of rules evaluated & outcome
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_inspections_pkey PRIMARY KEY (id),
  CONSTRAINT quality_inspections_inspection_no_key UNIQUE (inspection_no)
);
CREATE INDEX quality_inspections_supplier_id_inspected_at_idx ON quality_inspections (supplier_id, inspected_at);
CREATE INDEX quality_inspections_decision_idx ON quality_inspections (decision);

CREATE TABLE quality_holds (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id                     uuid NOT NULL,
  stage                      lot_stage NOT NULL,
  reason                     text NOT NULL,
  status                     hold_status NOT NULL DEFAULT 'ACTIVE',
  placed_by_id               uuid NOT NULL,
  placed_at                  timestamptz NOT NULL DEFAULT now(),
  released_by_id             uuid,
  released_at                timestamptz,
  release_notes              text,
  CONSTRAINT quality_holds_pkey PRIMARY KEY (id)
);
CREATE INDEX quality_holds_lot_id_status_idx ON quality_holds (lot_id, status);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE suppliers ADD CONSTRAINT suppliers_registered_by_id_fkey
  FOREIGN KEY (registered_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE supplier_documents ADD CONSTRAINT supplier_documents_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT;
ALTER TABLE supplier_documents ADD CONSTRAINT supplier_documents_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE equipment ADD CONSTRAINT equipment_responsible_employee_id_fkey
  FOREIGN KEY (responsible_employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE maintenance_schedules ADD CONSTRAINT maintenance_schedules_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT;
ALTER TABLE maintenance_schedules ADD CONSTRAINT maintenance_schedules_responsible_employee_id_fkey
  FOREIGN KEY (responsible_employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE machine_maintenance ADD CONSTRAINT machine_maintenance_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT;
ALTER TABLE machine_maintenance ADD CONSTRAINT machine_maintenance_performed_by_id_fkey
  FOREIGN KEY (performed_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE scales ADD CONSTRAINT scales_equipment_id_fkey
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE RESTRICT;
ALTER TABLE scale_calibrations ADD CONSTRAINT scale_calibrations_scale_id_fkey
  FOREIGN KEY (scale_id) REFERENCES scales (id) ON DELETE RESTRICT;
ALTER TABLE scale_calibrations ADD CONSTRAINT scale_calibrations_performed_by_id_fkey
  FOREIGN KEY (performed_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE scale_calibrations ADD CONSTRAINT scale_calibrations_certificate_doc_id_fkey
  FOREIGN KEY (certificate_doc_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE quality_inspections ADD CONSTRAINT quality_inspections_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT;
ALTER TABLE quality_inspections ADD CONSTRAINT quality_inspections_inspector_id_fkey
  FOREIGN KEY (inspector_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE quality_inspections ADD CONSTRAINT quality_inspections_quality_grade_id_fkey
  FOREIGN KEY (quality_grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE quality_holds ADD CONSTRAINT quality_holds_placed_by_id_fkey
  FOREIGN KEY (placed_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE quality_holds ADD CONSTRAINT quality_holds_released_by_id_fkey
  FOREIGN KEY (released_by_id) REFERENCES users (id) ON DELETE RESTRICT;
