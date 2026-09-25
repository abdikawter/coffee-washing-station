-- =============================================================================
-- 0009_finance
-- Expense categories, expenses, cash ledger.
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TABLE expense_categories (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  code                       text NOT NULL,
  name                       text NOT NULL,
  is_active                  boolean NOT NULL DEFAULT true,
  CONSTRAINT expense_categories_pkey PRIMARY KEY (id),
  CONSTRAINT expense_categories_code_key UNIQUE (code)
);

CREATE TABLE expenses (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  expense_no                 text NOT NULL,
  expense_date               date NOT NULL,
  category_id                uuid NOT NULL,
  amount                     numeric(14,2) NOT NULL,
  payee                      text NOT NULL,
  description                text NOT NULL,
  receipt_doc_id             uuid,
  status                     expense_status NOT NULL DEFAULT 'DRAFT',
  requested_by_id            uuid NOT NULL,
  approved_by_id             uuid,
  approved_at                timestamptz,
  reject_reason              text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_expense_no_key UNIQUE (expense_no)
);
CREATE INDEX expenses_expense_date_idx ON expenses (expense_date);
CREATE INDEX expenses_status_idx ON expenses (status);

CREATE TABLE cash_transactions (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  txn_number                 text NOT NULL,
  txn_date                   timestamptz NOT NULL,
  direction                  cash_direction NOT NULL,
  type                       cash_txn_type NOT NULL,
  amount                     numeric(14,2) NOT NULL,
  description                text NOT NULL,
  payment_id                 uuid,
  payroll_id                 uuid,
  expense_id                 uuid,
  reversal_of_id             uuid,
  cashier_id                 uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT cash_transactions_txn_number_key UNIQUE (txn_number),
  CONSTRAINT cash_transactions_reversal_of_id_key UNIQUE (reversal_of_id)
);
CREATE INDEX cash_transactions_txn_date_idx ON cash_transactions (txn_date);
CREATE INDEX cash_transactions_type_txn_date_idx ON cash_transactions (type, txn_date);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE expenses ADD CONSTRAINT expenses_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES expense_categories (id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD CONSTRAINT expenses_receipt_doc_id_fkey
  FOREIGN KEY (receipt_doc_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD CONSTRAINT expenses_requested_by_id_fkey
  FOREIGN KEY (requested_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD CONSTRAINT expenses_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES supplier_payments (id) ON DELETE RESTRICT;
ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_payroll_id_fkey
  FOREIGN KEY (payroll_id) REFERENCES payrolls (id) ON DELETE RESTRICT;
ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_expense_id_fkey
  FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE RESTRICT;
ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_reversal_of_id_fkey
  FOREIGN KEY (reversal_of_id) REFERENCES cash_transactions (id) ON DELETE RESTRICT;
ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_cashier_id_fkey
  FOREIGN KEY (cashier_id) REFERENCES users (id) ON DELETE RESTRICT;
