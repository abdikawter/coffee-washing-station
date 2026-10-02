-- =============================================================================
-- 0014_single_super_admin
-- Business decision (2026-10-02): for now the system has ONE role, SUPER_ADMIN,
-- which controls everything, and no segregation-of-duties rule. Operational
-- roles (ARCHITECTURE.md §7) are added again later on request.
-- =============================================================================

-- 1. Segregation of duties removed: drop the database-level guards from 0011.
ALTER TABLE purchase_vouchers      DROP CONSTRAINT IF EXISTS ck_pv_sod;
ALTER TABLE supplier_payments      DROP CONSTRAINT IF EXISTS ck_payment_sod;
ALTER TABLE store_receive_vouchers DROP CONSTRAINT IF EXISTS ck_srv_sod;
ALTER TABLE stock_transfers        DROP CONSTRAINT IF EXISTS ck_transfer_sod;
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS ck_inv_txn_sod;
ALTER TABLE payrolls               DROP CONSTRAINT IF EXISTS ck_payroll_sod;
ALTER TABLE attendances            DROP CONSTRAINT IF EXISTS ck_attendance_sod;
ALTER TABLE expenses               DROP CONSTRAINT IF EXISTS ck_expense_sod;
ALTER TABLE store_issue_vouchers   DROP CONSTRAINT IF EXISTS ck_siv_sod;
ALTER TABLE corrective_actions     DROP CONSTRAINT IF EXISTS ck_ca_sod;

-- 2. Databases seeded before this change: SUPER_ADMIN receives every permission
--    and the other seeded roles are removed. On an empty database these
--    statements do nothing (roles are created by the seed, which now knows only
--    SUPER_ADMIN with every permission).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

DELETE FROM user_roles
 WHERE role_id IN (SELECT id FROM roles WHERE code <> 'SUPER_ADMIN');
DELETE FROM roles WHERE code <> 'SUPER_ADMIN';  -- role_permissions rows cascade
