-- =============================================================================
-- 0004_purchasing_payments
-- Purchase vouchers, items, weight records, supplier payments.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE purchase_vouchers (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  voucher_no                 text NOT NULL,
  voucher_date               date NOT NULL,
  supplier_id                uuid NOT NULL,
  supplier_name_snap         text NOT NULL,
  supplier_phone_snap        text,
  coffee_type_id             uuid NOT NULL,
  quality_inspection_id      uuid NOT NULL,
  quality_grade_id           uuid,
  total_weight_kg            numeric(12,3) NOT NULL,
  price_per_kg               numeric(14,2) NOT NULL,
  total_amount               numeric(14,2) NOT NULL,
  status                     purchase_voucher_status NOT NULL DEFAULT 'DRAFT',
  scale_warning              text,  -- set when purchasing proceeded under WARN policy
  created_by_id              uuid NOT NULL,
  weighing_clerk_id          uuid NOT NULL,
  quality_inspector_id       uuid NOT NULL,
  cashier_id                 uuid,
  submitted_at               timestamptz,
  verified_by_id             uuid,
  verified_at                timestamptz,
  approved_by_id             uuid,
  approved_at                timestamptz,
  cancelled_by_id            uuid,
  cancelled_at               timestamptz,
  cancel_reason              text,
  version                    integer NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_vouchers_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_vouchers_voucher_no_key UNIQUE (voucher_no),
  CONSTRAINT purchase_vouchers_quality_inspection_id_key UNIQUE (quality_inspection_id)
);
CREATE INDEX purchase_vouchers_voucher_date_idx ON purchase_vouchers (voucher_date);
CREATE INDEX purchase_vouchers_supplier_id_voucher_date_idx ON purchase_vouchers (supplier_id, voucher_date);
CREATE INDEX purchase_vouchers_status_idx ON purchase_vouchers (status);

CREATE TABLE purchase_items (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  voucher_id                 uuid NOT NULL,
  line_no                    integer NOT NULL,
  coffee_type_id             uuid NOT NULL,
  quality_grade_id           uuid,
  weight_kg                  numeric(12,3) NOT NULL,
  price_per_kg               numeric(14,2) NOT NULL,
  amount                     numeric(14,2) NOT NULL,  -- weightKg × pricePerKg (server-computed)
  CONSTRAINT purchase_items_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_items_voucher_id_line_no_key UNIQUE (voucher_id, line_no)
);

CREATE TABLE weight_records (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  purchase_item_id           uuid NOT NULL,
  scale_id                   uuid NOT NULL,
  gross_kg                   numeric(12,3) NOT NULL,
  tare_kg                    numeric(12,3) NOT NULL DEFAULT 0,
  net_kg                     numeric(12,3) NOT NULL,
  weighed_by_id              uuid NOT NULL,
  weighed_at                 timestamptz NOT NULL,
  scale_verified             boolean NOT NULL,  -- was scale verified per policy at time of weighing
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weight_records_pkey PRIMARY KEY (id)
);
CREATE INDEX weight_records_scale_id_weighed_at_idx ON weight_records (scale_id, weighed_at);

CREATE TABLE supplier_payments (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_no                 text NOT NULL,
  voucher_id                 uuid NOT NULL,
  amount                     numeric(14,2) NOT NULL,
  payment_date               timestamptz NOT NULL,
  method                     payment_method NOT NULL,
  reference_no               text,
  status                     payment_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  cashier_id                 uuid NOT NULL,
  approved_by_id             uuid,
  approved_at                timestamptz,
  paid_at                    timestamptz,
  reject_reason              text,
  reversal_reason            text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_payments_pkey PRIMARY KEY (id),
  CONSTRAINT supplier_payments_payment_no_key UNIQUE (payment_no)
);
CREATE INDEX supplier_payments_voucher_id_idx ON supplier_payments (voucher_id);
CREATE INDEX supplier_payments_payment_date_idx ON supplier_payments (payment_date);
CREATE INDEX supplier_payments_status_idx ON supplier_payments (status);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_coffee_type_id_fkey
  FOREIGN KEY (coffee_type_id) REFERENCES coffee_types (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_quality_inspection_id_fkey
  FOREIGN KEY (quality_inspection_id) REFERENCES quality_inspections (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_quality_grade_id_fkey
  FOREIGN KEY (quality_grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_created_by_id_fkey
  FOREIGN KEY (created_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_weighing_clerk_id_fkey
  FOREIGN KEY (weighing_clerk_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_quality_inspector_id_fkey
  FOREIGN KEY (quality_inspector_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_cashier_id_fkey
  FOREIGN KEY (cashier_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_verified_by_id_fkey
  FOREIGN KEY (verified_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_vouchers ADD CONSTRAINT purchase_vouchers_cancelled_by_id_fkey
  FOREIGN KEY (cancelled_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_voucher_id_fkey
  FOREIGN KEY (voucher_id) REFERENCES purchase_vouchers (id) ON DELETE CASCADE;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_coffee_type_id_fkey
  FOREIGN KEY (coffee_type_id) REFERENCES coffee_types (id) ON DELETE RESTRICT;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_quality_grade_id_fkey
  FOREIGN KEY (quality_grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE weight_records ADD CONSTRAINT weight_records_purchase_item_id_fkey
  FOREIGN KEY (purchase_item_id) REFERENCES purchase_items (id) ON DELETE CASCADE;
ALTER TABLE weight_records ADD CONSTRAINT weight_records_scale_id_fkey
  FOREIGN KEY (scale_id) REFERENCES scales (id) ON DELETE RESTRICT;
ALTER TABLE weight_records ADD CONSTRAINT weight_records_weighed_by_id_fkey
  FOREIGN KEY (weighed_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_voucher_id_fkey
  FOREIGN KEY (voucher_id) REFERENCES purchase_vouchers (id) ON DELETE RESTRICT;
ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_cashier_id_fkey
  FOREIGN KEY (cashier_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
