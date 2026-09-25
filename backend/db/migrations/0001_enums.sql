-- =============================================================================
-- 0001_enums
-- All enumerated types (64).
-- Converted from the design blueprint (schema.prisma, reference only).
-- Plain PostgreSQL 16. Columns snake_case; money numeric(14,2), kg numeric(12,3),
-- percent numeric(5,2). Constraints the blueprint could not express live in 0011.
-- =============================================================================

CREATE TYPE user_status AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'LOCKED'
);

CREATE TYPE supplier_status AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED'
);

CREATE TYPE identification_type AS ENUM (
  'NATIONAL_ID',
  'LOCAL_ADMINISTRATION_ID',
  'PASSPORT',
  'OTHER'
);

CREATE TYPE document_category AS ENUM (
  'SUPPLIER_ID',
  'RECEIPT',
  'QUALITY',
  'CALIBRATION',
  'AUDIT_EVIDENCE',
  'CORRECTIVE_ACTION_EVIDENCE',
  'PAYROLL',
  'SIGNATURE',
  'THUMBPRINT',
  'REPORT',
  'OTHER'
);

CREATE TYPE storage_provider AS ENUM (
  'LOCAL',
  'S3'
);

CREATE TYPE equipment_type AS ENUM (
  'SCALE',
  'HOPPER',
  'PULPING_MACHINE',
  'FERMENTATION_TANK',
  'MOISTURE_METER',
  'OTHER'
);

CREATE TYPE equipment_status AS ENUM (
  'OPERATIONAL',
  'UNDER_MAINTENANCE',
  'OUT_OF_SERVICE',
  'DECOMMISSIONED'
);

CREATE TYPE maintenance_type AS ENUM (
  'INSPECTION',
  'CLEANING',
  'CALIBRATION',
  'PREVENTIVE',
  'REPAIR'
);

CREATE TYPE check_result AS ENUM (
  'PASS',
  'FAIL'
);

CREATE TYPE calibration_type AS ENUM (
  'DAILY_VERIFICATION',
  'CALIBRATION'
);

CREATE TYPE grade_stage AS ENUM (
  'CHERRY',
  'PARCHMENT'
);

CREATE TYPE quality_decision AS ENUM (
  'ACCEPTED',
  'REJECTED'
);

CREATE TYPE quality_metric AS ENUM (
  'RED_RIPE_PCT',
  'GREEN_UNRIPE_PCT',
  'OVERRIPE_DAMAGED_PCT'
);

CREATE TYPE comparison_operator AS ENUM (
  'LT',
  'LTE',
  'GT',
  'GTE'
);

CREATE TYPE quality_rule_action AS ENUM (
  'REJECT',
  'WARN'
);

CREATE TYPE hold_status AS ENUM (
  'ACTIVE',
  'RELEASED'
);

CREATE TYPE purchase_voucher_status AS ENUM (
  'DRAFT',
  'PENDING_VERIFICATION',
  'VERIFIED',
  'APPROVED',
  'PAID',
  'CANCELLED',
  'VOIDED'
);

CREATE TYPE payment_method AS ENUM (
  'CASH',
  'BANK_TRANSFER',
  'MOBILE_MONEY',
  'CHEQUE'
);

CREATE TYPE payment_status AS ENUM (
  'PENDING_APPROVAL',
  'APPROVED',
  'PAID',
  'REJECTED',
  'REVERSED'
);

CREATE TYPE lot_type AS ENUM (
  'PURCHASE',
  'GRADE_SPLIT',
  'SPLIT'
);

CREATE TYPE lot_stage AS ENUM (
  'PURCHASED',
  'HOPPER',
  'FLOTATION',
  'PULPING',
  'FERMENTATION',
  'WASHING',
  'GRADING',
  'DRYING',
  'FINAL_MOISTURE_VERIFIED',
  'WAREHOUSE',
  'RELEASED'
);

CREATE TYPE lot_status AS ENUM (
  'ACTIVE',
  'ON_HOLD',
  'SPLIT',
  'IN_STORE',
  'RELEASED',
  'REJECTED',
  'CLOSED'
);

CREATE TYPE lot_event_type AS ENUM (
  'PURCHASED',
  'HOPPER_RECEIVED',
  'FLOTATION_COMPLETED',
  'PULPED',
  'FERMENTATION_STARTED',
  'FERMENTATION_COMPLETED',
  'WASHED',
  'GRADED',
  'LOT_SPLIT',
  'DRYING_STARTED',
  'MOISTURE_CHECK',
  'DEFECT_RECORDED',
  'DRYING_COMPLETED',
  'FINAL_MOISTURE_VERIFIED',
  'WAREHOUSE_RECEIVED',
  'TRANSFERRED',
  'INVENTORY_ADJUSTED',
  'RELEASED',
  'QUALITY_HOLD_PLACED',
  'QUALITY_HOLD_RELEASED'
);

CREATE TYPE reconciliation_status AS ENUM (
  'BALANCED',
  'DISCREPANCY',
  'REVIEWED'
);

CREATE TYPE fermentation_status AS ENUM (
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE mucilage_assessment AS ENUM (
  'NOT_ASSESSED',
  'INCOMPLETE',
  'COMPLETE'
);

CREATE TYPE drying_bed_status AS ENUM (
  'AVAILABLE',
  'LOADED',
  'DRYING',
  'READY',
  'MAINTENANCE',
  'OUT_OF_SERVICE'
);

CREATE TYPE drying_batch_status AS ENUM (
  'LOADING',
  'DRYING',
  'READY_FOR_VERIFICATION',
  'VERIFIED',
  'RECEIVED_IN_STORE',
  'REJECTED'
);

CREATE TYPE moisture_status AS ENUM (
  'BELOW_TARGET',
  'WITHIN_TARGET',
  'ABOVE_TARGET'
);

CREATE TYPE defect_source AS ENUM (
  'PICKING',
  'INSPECTION'
);

CREATE TYPE warehouse_type AS ENUM (
  'PARCHMENT_STORE',
  'RATION_STORE',
  'GENERAL_STORE'
);

CREATE TYPE srv_status AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE item_category AS ENUM (
  'PARCHMENT_COFFEE',
  'RATION',
  'SUPPLY'
);

CREATE TYPE inventory_txn_type AS ENUM (
  'IN',
  'OUT',
  'TRANSFER',
  'ADJUSTMENT',
  'REVERSAL'
);

CREATE TYPE stock_direction AS ENUM (
  'IN',
  'OUT'
);

CREATE TYPE inventory_reference_type AS ENUM (
  'OPENING_BALANCE',
  'SRV',
  'SIV',
  'STOCK_TRANSFER',
  'ADJUSTMENT',
  'REVERSAL'
);

CREATE TYPE transfer_status AS ENUM (
  'PENDING_APPROVAL',
  'COMPLETED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE worker_status AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TYPE attendance_status AS ENUM (
  'PRESENT',
  'ABSENT',
  'EXCUSED'
);

CREATE TYPE confirmation_method AS ENUM (
  'SIGNATURE',
  'THUMBPRINT',
  'NONE'
);

CREATE TYPE approval_status AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE payroll_status AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'SUPERVISOR_APPROVED',
  'CASHIER_APPROVED',
  'PAID',
  'CANCELLED'
);

CREATE TYPE payroll_item_payment_status AS ENUM (
  'UNPAID',
  'PAID'
);

CREATE TYPE siv_purpose AS ENUM (
  'RATION',
  'COFFEE_RELEASE',
  'SUPPLY'
);

CREATE TYPE siv_status AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ISSUED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE recipient_type AS ENUM (
  'WORKER',
  'WORKER_GROUP',
  'EMPLOYEE',
  'EXTERNAL'
);

CREATE TYPE expense_status AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PAID',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE cash_direction AS ENUM (
  'IN',
  'OUT'
);

CREATE TYPE cash_txn_type AS ENUM (
  'CASH_FUNDING',
  'SUPPLIER_PAYMENT',
  'PAYROLL_PAYMENT',
  'EXPENSE_PAYMENT',
  'CASH_RETURN',
  'REVERSAL'
);

CREATE TYPE audit_area AS ENUM (
  'FINANCE',
  'INVENTORY',
  'PRODUCTION',
  'QUALITY',
  'WAREHOUSE',
  'PAYROLL'
);

CREATE TYPE audit_status AS ENUM (
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CLOSED',
  'CANCELLED'
);

CREATE TYPE audit_item_result AS ENUM (
  'COMPLIANT',
  'NON_COMPLIANT',
  'OBSERVATION',
  'NOT_APPLICABLE'
);

CREATE TYPE severity AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
);

CREATE TYPE corrective_action_source AS ENUM (
  'QUALITY_DEFECT',
  'WEIGHT_DISCREPANCY',
  'INVENTORY_DISCREPANCY',
  'MISSING_STOCK',
  'PROCESS_VIOLATION',
  'FAILED_CALIBRATION',
  'MOISTURE_PROBLEM',
  'AUDIT_FINDING'
);

CREATE TYPE corrective_action_status AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'VERIFIED',
  'CLOSED'
);

CREATE TYPE department AS ENUM (
  'PROCUREMENT',
  'QUALITY',
  'PRODUCTION',
  'DRYING',
  'WAREHOUSE',
  'FINANCE',
  'PAYROLL',
  'MAINTENANCE',
  'MANAGEMENT'
);

CREATE TYPE notification_type AS ENUM (
  'FERMENTATION_APPROACHING_THRESHOLD',
  'FERMENTATION_OVERDUE',
  'MOISTURE_OUT_OF_TARGET',
  'DRYING_BED_READY',
  'RAKING_OVERDUE',
  'SCALE_CALIBRATION_DUE',
  'RECONCILIATION_DISCREPANCY',
  'SRV_AWAITING_APPROVAL',
  'CORRECTIVE_ACTION_OVERDUE',
  'WAREHOUSE_APPROVAL_REQUIRED',
  'PAYMENT_AWAITING_APPROVAL',
  'PAYROLL_AWAITING_APPROVAL',
  'MAINTENANCE_DUE',
  'QUALITY_HOLD_PLACED',
  'GENERAL'
);

CREATE TYPE notification_channel AS ENUM (
  'IN_APP',
  'EMAIL',
  'SMS'
);

CREATE TYPE delivery_status AS ENUM (
  'PENDING',
  'SENT',
  'FAILED'
);

CREATE TYPE audit_action AS ENUM (
  'CREATE',
  'UPDATE',
  'SUBMIT',
  'VERIFY',
  'APPROVE',
  'REJECT',
  'PAY',
  'CANCEL',
  'VOID',
  'REVERSE',
  'TRANSFER',
  'ADJUST',
  'HOLD',
  'RELEASE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'EXPORT',
  'SETTING_CHANGE'
);

CREATE TYPE setting_value_type AS ENUM (
  'NUMBER',
  'STRING',
  'BOOLEAN',
  'ENUM',
  'JSON'
);

CREATE TYPE report_format AS ENUM (
  'PDF',
  'XLSX'
);

CREATE TYPE job_status AS ENUM (
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE outbox_status AS ENUM (
  'PENDING',
  'PROCESSED',
  'FAILED'
);
