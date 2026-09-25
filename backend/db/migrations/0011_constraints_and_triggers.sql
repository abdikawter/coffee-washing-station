-- =============================================================================
-- 0011_constraints_and_triggers
-- Constraints the blueprint could not express (ARCHITECTURE.md §6.4):
--   partial unique indexes, NULLS NOT DISTINCT ledger keys, CHECK constraints,
--   database-level segregation-of-duties guards, append-only ledgers,
--   updated_at maintenance.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Partial / special unique indexes
-- -----------------------------------------------------------------------------
-- One live payment per voucher (prevents duplicate payment).
CREATE UNIQUE INDEX ux_payment_live_per_voucher ON supplier_payments (voucher_id)
  WHERE status NOT IN ('REJECTED', 'REVERSED');
-- One active fermentation per tank.
CREATE UNIQUE INDEX ux_ferm_active_tank ON fermentation_batches (tank_id)
  WHERE status = 'IN_PROGRESS';
-- One active batch assignment per drying bed.
CREATE UNIQUE INDEX ux_bed_active ON drying_batch_beds (bed_id)
  WHERE unloaded_at IS NULL;
-- Ledger keys with nullable columns (lot / grade are optional for non-coffee items).
CREATE UNIQUE INDEX ux_stock_key ON stock_balances (item_id, lot_id, grade_id, stack_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX ux_bincard_key ON bin_cards (item_id, lot_id, grade_id, stack_id) NULLS NOT DISTINCT;
-- Only one ACTIVE quality hold per lot at a time.
CREATE UNIQUE INDEX ux_quality_hold_active ON quality_holds (lot_id) WHERE status = 'ACTIVE';

-- -----------------------------------------------------------------------------
-- Value checks
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD CONSTRAINT ck_users_failed_login CHECK (failed_login_count >= 0);
ALTER TABLE system_settings ADD CONSTRAINT ck_settings_source
  CHECK (source IN ('MANUAL', 'PROVISIONAL', 'UNSET', 'CONFIRMED'));
ALTER TABLE system_settings ADD CONSTRAINT ck_settings_version CHECK (version >= 1);
ALTER TABLE document_sequences ADD CONSTRAINT ck_docseq_nonneg CHECK (last_value >= 0);
ALTER TABLE documents ADD CONSTRAINT ck_documents_size CHECK (size_bytes >= 0);

ALTER TABLE scales ADD CONSTRAINT ck_scales_capacity CHECK (capacity_kg > 0 AND (readability_kg IS NULL OR readability_kg > 0));
ALTER TABLE scale_calibrations ADD CONSTRAINT ck_scale_cal_values
  CHECK (standard_weight_kg > 0 AND reading_kg >= 0 AND tolerance_kg >= 0);
ALTER TABLE maintenance_schedules ADD CONSTRAINT ck_maint_sched_interval CHECK (interval_days > 0);
ALTER TABLE machine_maintenance ADD CONSTRAINT ck_machine_maint_cost CHECK (cost IS NULL OR cost >= 0);

ALTER TABLE quality_settings ADD CONSTRAINT ck_quality_setting_threshold CHECK (threshold BETWEEN 0 AND 100);
ALTER TABLE quality_inspections ADD CONSTRAINT ck_q_pct CHECK (
  red_ripe_pct BETWEEN 0 AND 100 AND green_unripe_pct BETWEEN 0 AND 100 AND overripe_damaged_pct BETWEEN 0 AND 100);
ALTER TABLE quality_inspections ADD CONSTRAINT ck_q_rejection_reason
  CHECK (decision = 'ACCEPTED' OR rejection_reason IS NOT NULL);
ALTER TABLE quality_holds ADD CONSTRAINT ck_hold_release CHECK (
  status = 'ACTIVE' OR (released_by_id IS NOT NULL AND released_at IS NOT NULL));

ALTER TABLE purchase_vouchers ADD CONSTRAINT ck_pv_amounts
  CHECK (total_weight_kg >= 0 AND price_per_kg >= 0 AND total_amount >= 0 AND version >= 1);
ALTER TABLE purchase_items ADD CONSTRAINT ck_pi_pos
  CHECK (weight_kg > 0 AND price_per_kg >= 0 AND amount >= 0 AND line_no > 0);
ALTER TABLE weight_records ADD CONSTRAINT ck_weight_record
  CHECK (gross_kg > 0 AND tare_kg >= 0 AND tare_kg < gross_kg AND net_kg = gross_kg - tare_kg);
ALTER TABLE supplier_payments ADD CONSTRAINT ck_payment_amount CHECK (amount > 0);

ALTER TABLE lots ADD CONSTRAINT ck_lot_weights
  CHECK (original_cherry_weight_kg > 0 AND current_weight_kg >= 0 AND version >= 1);
ALTER TABLE lots ADD CONSTRAINT ck_lot_not_own_parent CHECK (parent_lot_id IS NULL OR parent_lot_id <> id);
ALTER TABLE lot_events ADD CONSTRAINT ck_lot_event_values CHECK (sequence > 0 AND (quantity_kg IS NULL OR quantity_kg >= 0));

ALTER TABLE hoppers ADD CONSTRAINT ck_hopper_capacity CHECK (capacity_kg > 0);
ALTER TABLE hopper_records ADD CONSTRAINT ck_hopper_record CHECK (
  purchased_cherry_kg >= 0 AND intake_kg > 0
  AND (floaters_kg IS NULL OR floaters_kg >= 0) AND (sinkers_kg IS NULL OR sinkers_kg >= 0));
ALTER TABLE hopper_reconciliations ADD CONSTRAINT ck_hopper_recon
  CHECK (purchased_cherry_kg >= 0 AND hopper_intake_kg >= 0 AND tolerance_pct >= 0);

ALTER TABLE pulping_machine_inspections ADD CONSTRAINT ck_pulper_spacing CHECK (disc_spacing_mm IS NULL OR disc_spacing_mm > 0);
ALTER TABLE pulping_records ADD CONSTRAINT ck_pulping_record CHECK (
  input_kg > 0 AND (output_kg IS NULL OR (output_kg >= 0 AND output_kg <= input_kg))
  AND (ended_at IS NULL OR ended_at >= started_at));

ALTER TABLE fermentation_tanks ADD CONSTRAINT ck_ferm_tank_capacity CHECK (capacity_kg > 0);
ALTER TABLE fermentation_batches ADD CONSTRAINT ck_ferm_batch CHECK (
  input_kg > 0 AND expected_duration_hours > 0 AND min_duration_hours >= 0
  AND min_duration_hours <= max_duration_hours AND (end_at IS NULL OR end_at >= start_at));
ALTER TABLE fermentation_measurements ADD CONSTRAINT ck_ferm_ph CHECK (ph IS NULL OR ph BETWEEN 0 AND 14);

ALTER TABLE washing_records ADD CONSTRAINT ck_washing CHECK (input_kg > 0 AND output_kg >= 0 AND output_kg <= input_kg);
ALTER TABLE grading_records ADD CONSTRAINT ck_grading_total CHECK (total_output_kg >= 0);
ALTER TABLE grade_outputs ADD CONSTRAINT ck_grade_output CHECK (weight_kg > 0);

ALTER TABLE drying_beds ADD CONSTRAINT ck_bed_capacity CHECK (capacity_kg > 0);
ALTER TABLE drying_batches ADD CONSTRAINT ck_drying_batch CHECK (
  initial_weight_kg > 0 AND (final_weight_kg IS NULL OR final_weight_kg >= 0)
  AND (current_moisture_pct IS NULL OR current_moisture_pct BETWEEN 0 AND 100)
  AND (final_moisture_pct IS NULL OR final_moisture_pct BETWEEN 0 AND 100));
ALTER TABLE drying_batch_beds ADD CONSTRAINT ck_batch_bed CHECK (
  loaded_kg > 0 AND (unloaded_at IS NULL OR unloaded_at >= loaded_at));
ALTER TABLE moisture_records ADD CONSTRAINT ck_moisture CHECK (
  moisture_pct BETWEEN 0 AND 100 AND target_min_pct BETWEEN 0 AND 100
  AND target_max_pct BETWEEN 0 AND 100 AND target_min_pct <= target_max_pct);
ALTER TABLE defect_records ADD CONSTRAINT ck_defect_qty CHECK (quantity_kg > 0);

ALTER TABLE warehouse_stacks ADD CONSTRAINT ck_stack_capacity CHECK (capacity_sacks IS NULL OR capacity_sacks > 0);
ALTER TABLE store_receive_vouchers ADD CONSTRAINT ck_srv_values CHECK (
  sack_count > 0 AND net_weight_kg > 0 AND moisture_pct BETWEEN 0 AND 100);
ALTER TABLE stock_balances ADD CONSTRAINT ck_stock_nonneg CHECK (quantity >= 0 AND sack_count >= 0 AND version >= 1);
ALTER TABLE bin_cards ADD CONSTRAINT ck_bincard_opening CHECK (opening_balance >= 0);
ALTER TABLE inventory_transactions ADD CONSTRAINT ck_inv_txn CHECK (
  quantity > 0 AND balance_after >= 0 AND sack_count >= 0
  AND (reversal_of_id IS NULL OR reversal_of_id <> id));
ALTER TABLE stock_transfers ADD CONSTRAINT ck_transfer CHECK (
  quantity > 0 AND sack_count >= 0 AND from_stack_id <> to_stack_id);

ALTER TABLE worker_roles ADD CONSTRAINT ck_worker_role_rate CHECK (default_daily_rate IS NULL OR default_daily_rate >= 0);
ALTER TABLE workers ADD CONSTRAINT ck_worker_rate CHECK (daily_rate IS NULL OR daily_rate >= 0);
ALTER TABLE worker_assignments ADD CONSTRAINT ck_assignment_dates CHECK (end_date IS NULL OR end_date >= start_date);
ALTER TABLE attendances ADD CONSTRAINT ck_attendance CHECK (
  (hours_worked IS NULL OR hours_worked BETWEEN 0 AND 24)
  AND (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at));
ALTER TABLE payrolls ADD CONSTRAINT ck_payroll CHECK (period_end >= period_start AND total_amount >= 0);
ALTER TABLE payroll_items ADD CONSTRAINT ck_payroll_item CHECK (
  days >= 0 AND (hours IS NULL OR hours >= 0) AND daily_rate >= 0 AND total >= 0);
ALTER TABLE store_issue_voucher_lines ADD CONSTRAINT ck_siv_line CHECK (quantity > 0 AND sack_count >= 0 AND line_no > 0);
ALTER TABLE ration_issues ADD CONSTRAINT ck_ration_issue CHECK (quantity > 0);

ALTER TABLE expenses ADD CONSTRAINT ck_expense_amount CHECK (amount > 0);
ALTER TABLE cash_transactions ADD CONSTRAINT ck_cash_txn CHECK (
  amount > 0 AND (reversal_of_id IS NULL OR reversal_of_id <> id));

ALTER TABLE audit_logs ADD CONSTRAINT ck_audit_hash CHECK (length(hash) = 64 AND (prev_hash IS NULL OR length(prev_hash) = 64));

-- -----------------------------------------------------------------------------
-- Segregation of duties, defence in depth (ARCHITECTURE.md §11.3).
-- The services enforce these first and return 403 SEGREGATION_OF_DUTIES;
-- these CHECKs guarantee no code path (or manual SQL) can bypass them.
-- -----------------------------------------------------------------------------
ALTER TABLE purchase_vouchers ADD CONSTRAINT ck_pv_sod CHECK (
  (cashier_id IS NULL OR cashier_id <> weighing_clerk_id)
  AND (verified_by_id IS NULL OR (verified_by_id <> created_by_id AND verified_by_id <> weighing_clerk_id))
  AND (approved_by_id IS NULL OR (approved_by_id <> created_by_id AND approved_by_id <> weighing_clerk_id
                                  AND approved_by_id IS DISTINCT FROM verified_by_id)));
ALTER TABLE supplier_payments ADD CONSTRAINT ck_payment_sod CHECK (approved_by_id IS NULL OR approved_by_id <> cashier_id);
ALTER TABLE store_receive_vouchers ADD CONSTRAINT ck_srv_sod CHECK (
  delivered_by_id <> received_by_id
  AND (approved_by_id IS NULL OR (approved_by_id <> delivered_by_id AND approved_by_id <> received_by_id)));
ALTER TABLE stock_transfers ADD CONSTRAINT ck_transfer_sod CHECK (approved_by_id IS NULL OR approved_by_id <> requested_by_id);
ALTER TABLE inventory_transactions ADD CONSTRAINT ck_inv_txn_sod CHECK (approved_by_id IS NULL OR approved_by_id <> created_by_id);
ALTER TABLE payrolls ADD CONSTRAINT ck_payroll_sod CHECK (
  (supervisor_approved_by_id IS NULL OR supervisor_approved_by_id <> prepared_by_id)
  AND (cashier_approved_by_id IS NULL OR (cashier_approved_by_id <> prepared_by_id
                                          AND cashier_approved_by_id IS DISTINCT FROM supervisor_approved_by_id)));
ALTER TABLE attendances ADD CONSTRAINT ck_attendance_sod CHECK (approved_by_id IS NULL OR approved_by_id <> recorded_by_id);
ALTER TABLE expenses ADD CONSTRAINT ck_expense_sod CHECK (approved_by_id IS NULL OR approved_by_id <> requested_by_id);
ALTER TABLE store_issue_vouchers ADD CONSTRAINT ck_siv_sod CHECK (approved_by_id IS NULL OR approved_by_id <> requested_by_id);
ALTER TABLE corrective_actions ADD CONSTRAINT ck_ca_sod CHECK (verified_by_id IS NULL OR verified_by_id <> responsible_id);

-- -----------------------------------------------------------------------------
-- Append-only ledgers: UPDATE, DELETE and TRUNCATE are rejected.
-- Corrections are made with reversal entries (ARCHITECTURE.md §1 principle 3).
-- -----------------------------------------------------------------------------
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME USING ERRCODE = 'P0A01';
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs', 'lot_events', 'inventory_transactions', 'cash_transactions'] LOOP
    EXECUTE format('CREATE TRIGGER t_%s_append_only BEFORE UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t, t);
    EXECUTE format('CREATE TRIGGER t_%s_no_truncate BEFORE TRUNCATE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t, t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- updated_at maintenance (replaces the ORM's @updatedAt)
-- -----------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'roles', 'employees', 'system_settings', 'document_sequences', 'suppliers', 'equipment',
    'maintenance_schedules', 'quality_settings', 'purchase_vouchers', 'supplier_payments', 'lots',
    'hopper_reconciliations', 'fermentation_batches', 'drying_beds', 'drying_batches',
    'store_receive_vouchers', 'stock_balances', 'workers', 'attendances', 'payrolls',
    'store_issue_vouchers', 'expenses', 'audits', 'corrective_actions'] LOOP
    EXECUTE format('CREATE TRIGGER t_%s_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
