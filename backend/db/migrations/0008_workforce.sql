-- =============================================================================
-- 0008_workforce
-- Workers, groups, assignments, attendance, payroll, rations, SIV.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE worker_roles (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,  -- RAKER, SORTER, HAULER, COOK, ... (configurable)
  name                       text NOT NULL,
  default_daily_rate         numeric(14,2),
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT worker_roles_pkey PRIMARY KEY (id),
  CONSTRAINT worker_roles_code_key UNIQUE (code)
);

CREATE TABLE worker_groups (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,
  name                       text NOT NULL,
  capita_id                  uuid,
  assigned_area              text,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_groups_pkey PRIMARY KEY (id),
  CONSTRAINT worker_groups_code_key UNIQUE (code)
);

CREATE TABLE workers (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_code                text NOT NULL,
  full_name                  text NOT NULL,
  phone                      text,
  role_id                    uuid NOT NULL,
  group_id                   uuid,
  is_capita                  boolean NOT NULL DEFAULT false,
  user_id                    uuid,  -- capitas who log in
  assigned_area              text,
  assigned_bed_id            uuid,
  daily_rate                 numeric(14,2),  -- overrides role default
  status                     worker_status NOT NULL DEFAULT 'ACTIVE',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workers_pkey PRIMARY KEY (id),
  CONSTRAINT workers_worker_code_key UNIQUE (worker_code),
  CONSTRAINT workers_user_id_key UNIQUE (user_id)
);
CREATE INDEX workers_group_id_idx ON workers (group_id);
CREATE INDEX workers_status_idx ON workers (status);
CREATE INDEX workers_full_name_idx ON workers (full_name);

CREATE TABLE worker_assignments (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id                  uuid NOT NULL,
  group_id                   uuid,
  bed_id                     uuid,
  area                       text,
  task                       text NOT NULL,
  start_date                 date NOT NULL,
  end_date                   date,
  assigned_by_id             uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_assignments_pkey PRIMARY KEY (id)
);
CREATE INDEX worker_assignments_worker_id_start_date_idx ON worker_assignments (worker_id, start_date);

CREATE TABLE payrolls (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  payroll_no                 text NOT NULL,
  period_start               date NOT NULL,
  period_end                 date NOT NULL,
  status                     payroll_status NOT NULL DEFAULT 'DRAFT',
  total_amount               numeric(14,2) NOT NULL DEFAULT 0,
  prepared_by_id             uuid NOT NULL,
  supervisor_approved_by_id  uuid,
  supervisor_approved_at     timestamptz,
  cashier_approved_by_id     uuid,
  cashier_approved_at        timestamptz,
  paid_at                    timestamptz,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payrolls_pkey PRIMARY KEY (id),
  CONSTRAINT payrolls_payroll_no_key UNIQUE (payroll_no)
);
CREATE INDEX payrolls_period_start_period_end_idx ON payrolls (period_start, period_end);
CREATE INDEX payrolls_status_idx ON payrolls (status);

CREATE TABLE payroll_items (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  payroll_id                 uuid NOT NULL,
  worker_id                  uuid NOT NULL,
  role_snapshot              text NOT NULL,
  area_snapshot              text,
  days                       numeric(6,2) NOT NULL,
  hours                      numeric(8,2),
  daily_rate                 numeric(14,2) NOT NULL,
  total                      numeric(14,2) NOT NULL,  -- days × dailyRate (server-computed)
  confirmation_method        confirmation_method NOT NULL DEFAULT 'NONE',
  confirmation_doc_id        uuid,
  payment_status             payroll_item_payment_status NOT NULL DEFAULT 'UNPAID',
  paid_at                    timestamptz,
  CONSTRAINT payroll_items_pkey PRIMARY KEY (id),
  CONSTRAINT payroll_items_payroll_id_worker_id_key UNIQUE (payroll_id, worker_id)
);

CREATE TABLE attendances (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id                  uuid NOT NULL,
  work_date                  date NOT NULL,
  check_in_at                timestamptz,
  check_out_at               timestamptz,
  hours_worked               numeric(5,2),
  role_id                    uuid NOT NULL,  -- snapshot of role that day
  bed_id                     uuid,
  area                       text,
  status                     attendance_status NOT NULL,
  confirmation_method        confirmation_method NOT NULL DEFAULT 'NONE',
  confirmation_doc_id        uuid,
  recorded_by_id             uuid NOT NULL,
  approval_status            approval_status NOT NULL DEFAULT 'PENDING',
  approved_by_id             uuid,
  approved_at                timestamptz,
  payroll_item_id            uuid,  -- set when included in payroll (prevents double pay)
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendances_pkey PRIMARY KEY (id),
  CONSTRAINT attendances_worker_id_work_date_key UNIQUE (worker_id, work_date)
);
CREATE INDEX attendances_work_date_approval_status_idx ON attendances (work_date, approval_status);

CREATE TABLE ration_items (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id                    uuid NOT NULL,
  issue_unit                 text NOT NULL,
  notes                      text,
  CONSTRAINT ration_items_pkey PRIMARY KEY (id),
  CONSTRAINT ration_items_item_id_key UNIQUE (item_id)
);

CREATE TABLE store_issue_vouchers (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  siv_number                 text NOT NULL,
  siv_date                   date NOT NULL,
  purpose                    siv_purpose NOT NULL,
  recipient_type             recipient_type NOT NULL,
  recipient_worker_id        uuid,
  recipient_group_id         uuid,
  recipient_name             text NOT NULL,  -- snapshot / external recipient
  status                     siv_status NOT NULL DEFAULT 'DRAFT',
  requested_by_id            uuid NOT NULL,
  approved_by_id             uuid,
  approved_at                timestamptz,
  issued_by_id               uuid,
  issued_at                  timestamptz,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_issue_vouchers_pkey PRIMARY KEY (id),
  CONSTRAINT store_issue_vouchers_siv_number_key UNIQUE (siv_number)
);
CREATE INDEX store_issue_vouchers_siv_date_idx ON store_issue_vouchers (siv_date);
CREATE INDEX store_issue_vouchers_status_idx ON store_issue_vouchers (status);

CREATE TABLE store_issue_voucher_lines (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  siv_id                     uuid NOT NULL,
  line_no                    integer NOT NULL,
  item_id                    uuid NOT NULL,
  lot_id                     uuid,
  stack_id                   uuid NOT NULL,
  quantity                   numeric(14,3) NOT NULL,
  sack_count                 integer NOT NULL DEFAULT 0,
  CONSTRAINT store_issue_voucher_lines_pkey PRIMARY KEY (id),
  CONSTRAINT store_issue_voucher_lines_siv_id_line_no_key UNIQUE (siv_id, line_no)
);

CREATE TABLE ration_issues (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  siv_id                     uuid NOT NULL,
  ration_item_id             uuid NOT NULL,
  quantity                   numeric(14,3) NOT NULL,
  issue_date                 date NOT NULL,
  recipient                  text NOT NULL,
  CONSTRAINT ration_issues_pkey PRIMARY KEY (id)
);
CREATE INDEX ration_issues_issue_date_idx ON ration_issues (issue_date);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE workers ADD CONSTRAINT workers_role_id_fkey
  FOREIGN KEY (role_id) REFERENCES worker_roles (id) ON DELETE RESTRICT;
ALTER TABLE workers ADD CONSTRAINT workers_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES worker_groups (id) ON DELETE RESTRICT;
ALTER TABLE workers ADD CONSTRAINT workers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE workers ADD CONSTRAINT workers_assigned_bed_id_fkey
  FOREIGN KEY (assigned_bed_id) REFERENCES drying_beds (id) ON DELETE RESTRICT;
ALTER TABLE raking_records ADD CONSTRAINT raking_records_worker_id_fkey
  FOREIGN KEY (worker_id) REFERENCES workers (id) ON DELETE RESTRICT;
ALTER TABLE defect_records ADD CONSTRAINT defect_records_worker_id_fkey
  FOREIGN KEY (worker_id) REFERENCES workers (id) ON DELETE RESTRICT;
ALTER TABLE worker_groups ADD CONSTRAINT worker_groups_capita_id_fkey
  FOREIGN KEY (capita_id) REFERENCES workers (id) ON DELETE RESTRICT;
ALTER TABLE worker_assignments ADD CONSTRAINT worker_assignments_worker_id_fkey
  FOREIGN KEY (worker_id) REFERENCES workers (id) ON DELETE RESTRICT;
ALTER TABLE worker_assignments ADD CONSTRAINT worker_assignments_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES worker_groups (id) ON DELETE RESTRICT;
ALTER TABLE worker_assignments ADD CONSTRAINT worker_assignments_bed_id_fkey
  FOREIGN KEY (bed_id) REFERENCES drying_beds (id) ON DELETE RESTRICT;
ALTER TABLE worker_assignments ADD CONSTRAINT worker_assignments_assigned_by_id_fkey
  FOREIGN KEY (assigned_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE payrolls ADD CONSTRAINT payrolls_prepared_by_id_fkey
  FOREIGN KEY (prepared_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE payrolls ADD CONSTRAINT payrolls_supervisor_approved_by_id_fkey
  FOREIGN KEY (supervisor_approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE payrolls ADD CONSTRAINT payrolls_cashier_approved_by_id_fkey
  FOREIGN KEY (cashier_approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE payroll_items ADD CONSTRAINT payroll_items_payroll_id_fkey
  FOREIGN KEY (payroll_id) REFERENCES payrolls (id) ON DELETE RESTRICT;
ALTER TABLE payroll_items ADD CONSTRAINT payroll_items_worker_id_fkey
  FOREIGN KEY (worker_id) REFERENCES workers (id) ON DELETE RESTRICT;
ALTER TABLE payroll_items ADD CONSTRAINT payroll_items_confirmation_doc_id_fkey
  FOREIGN KEY (confirmation_doc_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD CONSTRAINT attendances_worker_id_fkey
  FOREIGN KEY (worker_id) REFERENCES workers (id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD CONSTRAINT attendances_role_id_fkey
  FOREIGN KEY (role_id) REFERENCES worker_roles (id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD CONSTRAINT attendances_bed_id_fkey
  FOREIGN KEY (bed_id) REFERENCES drying_beds (id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD CONSTRAINT attendances_confirmation_doc_id_fkey
  FOREIGN KEY (confirmation_doc_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD CONSTRAINT attendances_recorded_by_id_fkey
  FOREIGN KEY (recorded_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD CONSTRAINT attendances_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD CONSTRAINT attendances_payroll_item_id_fkey
  FOREIGN KEY (payroll_item_id) REFERENCES payroll_items (id) ON DELETE RESTRICT;
ALTER TABLE ration_items ADD CONSTRAINT ration_items_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_vouchers ADD CONSTRAINT store_issue_vouchers_recipient_worker_id_fkey
  FOREIGN KEY (recipient_worker_id) REFERENCES workers (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_vouchers ADD CONSTRAINT store_issue_vouchers_recipient_group_id_fkey
  FOREIGN KEY (recipient_group_id) REFERENCES worker_groups (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_vouchers ADD CONSTRAINT store_issue_vouchers_requested_by_id_fkey
  FOREIGN KEY (requested_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_vouchers ADD CONSTRAINT store_issue_vouchers_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_vouchers ADD CONSTRAINT store_issue_vouchers_issued_by_id_fkey
  FOREIGN KEY (issued_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_voucher_lines ADD CONSTRAINT store_issue_voucher_lines_siv_id_fkey
  FOREIGN KEY (siv_id) REFERENCES store_issue_vouchers (id) ON DELETE CASCADE;
ALTER TABLE store_issue_voucher_lines ADD CONSTRAINT store_issue_voucher_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_voucher_lines ADD CONSTRAINT store_issue_voucher_lines_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES lots (id) ON DELETE RESTRICT;
ALTER TABLE store_issue_voucher_lines ADD CONSTRAINT store_issue_voucher_lines_stack_id_fkey
  FOREIGN KEY (stack_id) REFERENCES warehouse_stacks (id) ON DELETE RESTRICT;
ALTER TABLE ration_issues ADD CONSTRAINT ration_issues_siv_id_fkey
  FOREIGN KEY (siv_id) REFERENCES store_issue_vouchers (id) ON DELETE RESTRICT;
ALTER TABLE ration_issues ADD CONSTRAINT ration_issues_ration_item_id_fkey
  FOREIGN KEY (ration_item_id) REFERENCES ration_items (id) ON DELETE RESTRICT;
