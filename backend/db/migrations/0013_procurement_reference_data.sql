-- =============================================================================
-- 0013_procurement_reference_data
-- Phase 2 (Procurement): reference data and one schema correction.
-- =============================================================================

-- scale.verificationToleranceKg is UNSET by default: the verifier then records
-- PASS/FAIL explicitly and there is no tolerance to snapshot. NULL = "no
-- tolerance configured at the time of the check" (the CHECK >= 0 still applies).
ALTER TABLE scale_calibrations ALTER COLUMN tolerance_kg DROP NOT NULL;

-- Coffee type bought at the station (extendable in the UI).
INSERT INTO coffee_types (code, name) VALUES ('RED_CHERRY', 'Red cherry (Arabica)')
ON CONFLICT (code) DO NOTHING;

-- Parchment grades produced by grading (ARCHITECTURE.md §20 assumptions).
-- Cherry grades are configured by the Quality Inspector / Site Manager.
INSERT INTO coffee_grades (code, name, stage, sort_order) VALUES
  ('G1', 'Grade 1', 'PARCHMENT', 1),
  ('G2', 'Grade 2', 'PARCHMENT', 2)
ON CONFLICT (stage, code) DO NOTHING;

-- Payment queue (list by status, newest first).
CREATE INDEX supplier_payments_status_created_at_idx ON supplier_payments (status, created_at);
