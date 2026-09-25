-- =============================================================================
-- 0007_warehouse_inventory
-- Warehouses, stacks, items, SRV, stock ledger, bin cards, transfers.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE warehouses (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,
  name                       text NOT NULL,
  type                       warehouse_type NOT NULL,
  location                   text,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_pkey PRIMARY KEY (id),
  CONSTRAINT warehouses_code_key UNIQUE (code)
);

CREATE TABLE warehouse_sections (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id               uuid NOT NULL,
  code                       text NOT NULL,
  name                       text NOT NULL,
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT warehouse_sections_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_sections_warehouse_id_code_key UNIQUE (warehouse_id, code)
);

CREATE TABLE warehouse_stacks (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  section_id                 uuid NOT NULL,
  code                       text NOT NULL,
  capacity_sacks             integer,
  qr_token                   text NOT NULL,
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT warehouse_stacks_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_stacks_qr_token_key UNIQUE (qr_token),
  CONSTRAINT warehouse_stacks_section_id_code_key UNIQUE (section_id, code)
);

CREATE TABLE inventory_items (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,
  name                       text NOT NULL,
  category                   item_category NOT NULL,
  unit                       text NOT NULL,  -- "kg", "sack", "litre", ...
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT inventory_items_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_items_code_key UNIQUE (code)
);

CREATE TABLE store_receive_vouchers (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  srv_number                 text NOT NULL,
  srv_date                   date NOT NULL,
  lot_id                     uuid NOT NULL,
  drying_batch_id            uuid NOT NULL,
  grade_id                   uuid NOT NULL,
  bed_codes                  text NOT NULL,  -- snapshot of bed number(s)
  moisture_record_id         uuid NOT NULL,  -- final verification reading
  moisture_pct               numeric(5,2) NOT NULL,
  sack_count                 integer NOT NULL,
  net_weight_kg              numeric(12,3) NOT NULL,
  stack_id                   uuid NOT NULL,
  delivered_by_id            uuid NOT NULL,
  received_by_id             uuid NOT NULL,
  approved_by_id             uuid,
  approved_at                timestamptz,
  status                     srv_status NOT NULL DEFAULT 'DRAFT',
  reject_reason              text,
  pdf_document_id            uuid,
  qr_token                   text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_receive_vouchers_pkey PRIMARY KEY (id),
  CONSTRAINT store_receive_vouchers_srv_number_key UNIQUE (srv_number),
  CONSTRAINT store_receive_vouchers_qr_token_key UNIQUE (qr_token)
);
CREATE INDEX store_receive_vouchers_srv_date_idx ON store_receive_vouchers (srv_date);
CREATE INDEX store_receive_vouchers_lot_id_idx ON store_receive_vouchers (lot_id);
CREATE INDEX store_receive_vouchers_status_idx ON store_receive_vouchers (status);

CREATE TABLE stock_balances (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id                    uuid NOT NULL,
  lot_id                     uuid,
  grade_id                   uuid,
  stack_id                   uuid NOT NULL,
  quantity                   numeric(14,3) NOT NULL,
  sack_count                 integer NOT NULL DEFAULT 0,
  version                    integer NOT NULL DEFAULT 1,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_balances_pkey PRIMARY KEY (id)
);
CREATE INDEX stock_balances_stack_id_idx ON stock_balances (stack_id);
CREATE INDEX stock_balances_lot_id_idx ON stock_balances (lot_id);

CREATE TABLE bin_cards (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  bin_card_no                text NOT NULL,
  item_id                    uuid NOT NULL,
  lot_id                     uuid,
  grade_id                   uuid,
  stack_id                   uuid NOT NULL,
  opening_balance            numeric(14,3) NOT NULL DEFAULT 0,
  opened_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bin_cards_pkey PRIMARY KEY (id),
  CONSTRAINT bin_cards_bin_card_no_key UNIQUE (bin_card_no)
);

CREATE TABLE stock_transfers (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  transfer_no                text NOT NULL,
  item_id                    uuid NOT NULL,
  lot_id                     uuid,
  from_stack_id              uuid NOT NULL,
  to_stack_id                uuid NOT NULL,
  quantity                   numeric(14,3) NOT NULL,
  sack_count                 integer NOT NULL DEFAULT 0,
  reason                     text,
  status                     transfer_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  requested_by_id            uuid NOT NULL,
  approved_by_id             uuid,
  approved_at                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_pkey PRIMARY KEY (id),
  CONSTRAINT stock_transfers_transfer_no_key UNIQUE (transfer_no)
);
CREATE INDEX stock_transfers_status_idx ON stock_transfers (status);

CREATE TABLE inventory_transactions (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  txn_number                 text NOT NULL,
  type                       inventory_txn_type NOT NULL,
  direction                  stock_direction NOT NULL,
  item_id                    uuid NOT NULL,
  lot_id                     uuid,
  grade_id                   uuid,
  stack_id                   uuid NOT NULL,
  bin_card_id                uuid NOT NULL,
  quantity                   numeric(14,3) NOT NULL,  -- always positive; sign from direction
  unit                       text NOT NULL,
  sack_count                 integer NOT NULL DEFAULT 0,
  balance_after              numeric(14,3) NOT NULL,
  reference_type             inventory_reference_type NOT NULL,
  reference_id               uuid NOT NULL,
  transfer_id                uuid,
  reversal_of_id             uuid,
  reason                     text,
  created_by_id              uuid NOT NULL,
  approved_by_id             uuid,
  occurred_at                timestamptz NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_transactions_txn_number_key UNIQUE (txn_number),
  CONSTRAINT inventory_transactions_reversal_of_id_key UNIQUE (reversal_of_id)
);
CREATE INDEX inventory_transactions_bin_card_id_occurred_at_idx ON inventory_transactions (bin_card_id, occurred_at);
CREATE INDEX inventory_transactions_lot_id_occurred_at_idx ON inventory_transactions (lot_id, occurred_at);
CREATE INDEX inventory_transactions_stack_id_occurred_at_idx ON inventory_transactions (stack_id, occurred_at);
CREATE INDEX inventory_transactions_reference_type_reference_id_idx ON inventory_transactions (reference_type, reference_id);
CREATE INDEX inventory_transactions_occurred_at_idx ON inventory_transactions (occurred_at);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE warehouse_sections ADD CONSTRAINT warehouse_sections_warehouse_id_fkey
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE RESTRICT;
ALTER TABLE warehouse_stacks ADD CONSTRAINT warehouse_stacks_section_id_fkey
  FOREIGN KEY (section_id) REFERENCES warehouse_sections (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_drying_batch_id_fkey
  FOREIGN KEY (drying_batch_id) REFERENCES drying_batches (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_moisture_record_id_fkey
  FOREIGN KEY (moisture_record_id) REFERENCES moisture_records (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_stack_id_fkey
  FOREIGN KEY (stack_id) REFERENCES warehouse_stacks (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_delivered_by_id_fkey
  FOREIGN KEY (delivered_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_received_by_id_fkey
  FOREIGN KEY (received_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE store_receive_vouchers ADD CONSTRAINT store_receive_vouchers_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT;
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_stack_id_fkey
  FOREIGN KEY (stack_id) REFERENCES warehouse_stacks (id) ON DELETE RESTRICT;
ALTER TABLE bin_cards ADD CONSTRAINT bin_cards_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT;
ALTER TABLE bin_cards ADD CONSTRAINT bin_cards_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE bin_cards ADD CONSTRAINT bin_cards_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE bin_cards ADD CONSTRAINT bin_cards_stack_id_fkey
  FOREIGN KEY (stack_id) REFERENCES warehouse_stacks (id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_from_stack_id_fkey
  FOREIGN KEY (from_stack_id) REFERENCES warehouse_stacks (id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_to_stack_id_fkey
  FOREIGN KEY (to_stack_id) REFERENCES warehouse_stacks (id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_requested_by_id_fkey
  FOREIGN KEY (requested_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_grade_id_fkey
  FOREIGN KEY (grade_id) REFERENCES coffee_grades (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_stack_id_fkey
  FOREIGN KEY (stack_id) REFERENCES warehouse_stacks (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_bin_card_id_fkey
  FOREIGN KEY (bin_card_id) REFERENCES bin_cards (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transfer_id_fkey
  FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_reversal_of_id_fkey
  FOREIGN KEY (reversal_of_id) REFERENCES inventory_transactions (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_created_by_id_fkey
  FOREIGN KEY (created_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
