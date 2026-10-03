# Coffee Washing Station Management System — Build Plan

**Stack:** React + TypeScript + Vite + MUI → REST API → Node.js + Express (TypeScript) → PostgreSQL (`pg`, plain SQL migrations) → pgAdmin · pg-boss jobs · JWT + refresh tokens · Jest + Supertest · Swagger · PDFKit · ExcelJS · Render (Web Service + Static Site + PostgreSQL) + S3-compatible storage · Git + GitHub.

**Design reference:** `docs/ARCHITECTURE.md` (v2). Section numbers below (§) point there.

**Status legend:** ✅ done · 🔜 next · ⬜ planned

| Phase | Name | Delivers | Status |
|---|---|---|---|
| 0 | Local setup | Every developer can run, test and push the project | ✅ |
| 1 | Foundation | Auth, users & roles, settings, audit log, files, jobs, full database, app shell | ✅ |
| 2 | Procurement | Suppliers → quality → scales → purchase voucher → payment → lot | ✅ |
| 3 | Wet processing | Lots & events, hopper/flotation, reconciliation, pulping, fermentation, washing, grading | ✅ |
| 4 | Drying | Beds, batches, raking, moisture, defects, final verification, mobile screens | 🔜 |
| 5 | Warehouse & traceability | SRV, inventory ledger, bin cards, transfers, adjustments, lot passport, QR | ⬜ |
| 6 | Workforce | Workers, groups/capitas, attendance, payroll, rations/SIV | ⬜ |
| 7 | Controls | Expenses, cash summaries, audits, corrective actions, notifications, approval inbox | ⬜ |
| 8 | Reporting | Daily/weekly/monthly reports, dashboards, PDF/Excel exports, yield | ⬜ |
| 9 | Production readiness | Security review, performance, backups, monitoring, go-live on Render | ⬜ |

Each phase ends only when its **exit gate** (bottom of each phase + the common gate below) is green.

---

## How every phase is built

### Order of work inside a phase
1. **Confirm rules**: re-read the phase's rows in §9 (workflow), §11 (rules) and §20 (settings); list open questions; agree defaults (a PROVISIONAL setting when unsure).
2. **Database**: the tables already exist (migrations 0001–0012). Add a new migration `NNNN_*.sql` only for seed/reference data, extra indexes or corrections — never edit an applied file.
3. **Domain code** (`modules/<m>/domain/*.ts`): pure calculators, state machines, validators + unit tests first.
4. **Services**: `withTransaction`, row locks, settings snapshot, audit row, lot event / ledger entry, outbox event — all in one transaction.
5. **Routes**: `api.route(...)` with `access` permission, Zod schemas, response schema → appears in Swagger automatically.
6. **Frontend**: API functions + types, pages, forms (React Hook Form + Zod), permission gating with `<Can>`.
7. **Jobs**: pg-boss queues/schedules the phase needs.
8. **Tests**: unit + integration (real PostgreSQL) + authorization matrix (automatic) + the phase's end-to-end scenario.
9. **Docs**: update §8 endpoint table, mark the phase ✅ here, note any new settings in §20.
10. **Commit, push, CI green**, deploy to staging on Render.

### Conventions (apply to all phases)
- Money `numeric(14,2)`, weight `numeric(12,3)`, % `numeric(5,2)`; decimals travel as **strings**; arithmetic with `decimal.js` only.
- Business dates `YYYY-MM-DD` in the station timezone; events `timestamptz`.
- State changes are **commands** (`POST /x/:id/approve`) with `{version, reason?}`; optimistic locking via `version`.
- Ledgers (`lot_events`, `inventory_transactions`, `cash_transactions`, `audit_logs`) are append-only; corrections = reversal entries.
- Segregation of duties is **not** enforced for now (single SUPER_ADMIN; see "Access model (current)" below).
- Money- and stock-moving commands are `idempotent: true` (Idempotency-Key).
- Document numbers come from `SequenceService` (`numbering.formats` setting).
- Thresholds come from settings; if a required one is UNSET → 422 `SETTING_NOT_CONFIGURED`; the value used is snapshotted on the record.

### Common exit gate (every phase)
- `npm run typecheck` and `npm run lint` pass (backend + frontend).
- `npm test` green: unit, integration, authorization matrix (every route × SUPER_ADMIN + test roles).
- Migrations apply on an empty database; the phase's end-to-end scenario passes.
- `npm run build` (both apps) and `npm run openapi` succeed; GitHub Actions CI green.
- Manual walkthrough on a phone-width screen for any mobile page.
- Docs updated.

---

## Phase 0 — Local setup ✅

**Goal:** anyone can run the system on a PC and push changes.

- Tools: Node.js **22.22.2+** (or 24.15+), PostgreSQL 16 with pgAdmin 4, Git, VS Code.
- `backend/.env` from `.env.example` (DATABASE_URL, JWT_ACCESS_SECRET, SEED_ADMIN_PASSWORD).
- `npm ci` → `npm run migrate` → `npm run seed` → `npm run dev` (API :4000, Swagger `/api/docs`).
- `frontend`: `npm ci` → `npm run dev` (:5173, proxies `/api`).
- GitHub repository created; `main` pushed; CI runs on every push.

**Exit:** login works locally; `/api/v1/health/ready` = ok; CI green on GitHub.

---

## Phase 1 — Foundation ✅

**Goal:** a secure, audited platform every later module plugs into.

**Delivered**
- **Database:** all 78 tables, 64 enums, 196 foreign keys, ~60 CHECKs, SoD CHECKs, partial unique indexes, append-only triggers, `updated_at` triggers, `idempotency_keys`; migration runner with checksums; optional least-privilege roles (`db/roles.sql`).
- **Seed:** 11 roles, 129 permission codes (§7 matrix), 47 settings (§20), first SUPER_ADMIN.
- **Auth:** login, lockout (5 tries / 15 min), forced password change, rotating refresh cookie with reuse detection, logout, `/auth/me`.
- **Users & access:** users CRUD, roles, deactivate/activate/unlock/reset password, role-permission editing, employees; guards (last SUPER_ADMIN, no self-deactivation).
- **Settings:** list, "to confirm" list, change/confirm with reason + version + audit; business vs system keys.
- **Audit log:** hash-chained, search, integrity verification.
- **Files:** upload (PDF/PNG/JPEG/WebP by magic bytes), metadata, download; local disk or S3.
- **Platform:** route registry (deny by default), Zod validation, error envelope, Swagger, pino logs + request ids, rate limits, idempotency, document sequences, outbox → pg-boss worker, nightly housekeeping job, health checks.
- **Frontend:** login, change password, app shell with permission-based navigation, dashboard shell, Users, Roles, Settings, Audit log pages; "settings to confirm" banner.
- **Delivery:** `render.yaml`, `docker-compose.yml` (PostgreSQL + pgAdmin), GitHub Actions CI, README.

**Exit (met):** 129 backend tests + 9 frontend tests green; production-style start on an empty DB OK.

---

## Phase 2 — Procurement ✅

**Goal:** buy red cherry end to end: farmer → inspection → verified scale → voucher → approval → payment → lot.

**Backend modules:** `suppliers`, `quality`, `equipment` (incl. `scales`), `purchasing`, `payments`, `finance` (cash ledger part), lot-creation hook.

**Tables used:** suppliers, supplier_documents, coffee_types, coffee_grades, quality_settings, quality_inspections, quality_holds, equipment, scales, scale_calibrations, machine_maintenance, maintenance_schedules, purchase_vouchers, purchase_items, weight_records, supplier_payments, cash_transactions, lots, lot_events.

**Features & rules**
1. **Suppliers** — register (unique code; unique ID type + number), QR token, ID documents, status changes with reason, history (purchases, payments, inspections).
2. **Reference data** — coffee types; grades (seed Grade 1 / Grade 2 parchment, cherry grades configurable).
3. **Quality inspection** — supplier must be ACTIVE; red/green/overripe 0–100 and sum within `quality.percentSumTolerance`; configured rules evaluated (REJECT forces rejection, WARN recorded); evaluation snapshot stored.
4. **Quality holds** — place / release (`quality:hold`, `quality:hold-release`); an active hold blocks every forward step of the lot and its children.
5. **Equipment & maintenance** — equipment register, maintenance records, schedules.
6. **Scale verification** — daily [MANUAL]; PASS if |reading − standard| ≤ `scale.verificationToleranceKg` (UNSET → verifier chooses PASS/FAIL); FAIL → scale OUT_OF_SERVICE + corrective action `FAILED_CALIBRATION` (CA table used; full CA module in Phase 7).
7. **Purchase voucher** — draft with items + weight records; inspection must be ACCEPTED, unused, same supplier; each weighing on a scale verified within `scale.verificationFrequencyHours`, else per `scale.unverifiedPolicy` (BLOCK → 422 / WARN → allowed + `scale_warning`); `net = gross − tare`; `amount = weight × price/kg` [MANUAL]; totals computed server-side.
8. **Voucher state machine** — DRAFT → PENDING_VERIFICATION → VERIFIED → APPROVED → PAID; cancel (DRAFT/PENDING/VERIFIED); return to draft (reason); void (APPROVED; PAID only after payment reversed and lot not beyond PURCHASED).
9. **SoD** — verifier ∉ {creator, weighing clerk}; approver ∉ {creator, weighing clerk, verifier}; cashier ≠ weighing clerk.
10. **Voucher PDF** — PDFKit, synchronous (`GET /purchases/:id/pdf`).
11. **Payments** — create (amount = voucher total; voucher APPROVED) → approve/reject (`payment.requiresApproval`) → disburse (writes `cash_transactions` OUT; voucher → PAID) → reverse (mirror cash entry); one live payment per voucher (DB partial unique); approver ≠ cashier; idempotent.
12. **Cash ledger** — `CashLedgerService` (only writer); cash funding/return entries.
13. **Lot creation** — at `purchase.lotCreationTrigger` (default ON_PAYMENT; option ON_APPROVAL), same transaction: lot number `LOT-YYMMDD-0001`, QR token, `original_cherry_weight_kg`, event `PURCHASED`.

**Main endpoints:** `/suppliers` (+ `/status`, `/documents`, `/history`), `/quality/inspections`, `/quality/holds` (+ `/release`), `/quality/rules`, `/quality/grades`, `/coffee-types`, `/equipment`, `/maintenance`, `/scales` (+ `/calibrations`, `/status`), `/purchases` (+ `/submit`, `/verify`, `/return`, `/approve`, `/cancel`, `/void`, `/pdf`), `/payments` (+ `/approve`, `/reject`, `/disburse`, `/reverse`), `/finance/cash`.

**Frontend:** Suppliers (list, profile, documents, QR), Quality (inspection form, holds, rules), Scales (daily check, status board), Equipment, Purchasing (voucher list, tablet-friendly weighing form, approval bar, PDF), Payments (queue, disburse), dashboard cards (today's cherry kg, pending approvals).

**Jobs:** `calibration-due` (hourly) — notifications arrive with Phase 7; the job logs/flags until then.

**Tests / exit gate**
- Unit: purchase calculator & rounding, voucher state machine (every allowed/forbidden transition), quality rule evaluator, percent-sum, scale verification.
- Integration: supplier → inspection → scale check → voucher → verify → approve → pay → lot + `PURCHASED` event.
- SoD: each forbidden same-person step returns 403 `SEGREGATION_OF_DUTIES`.
- Concurrency: two parallel payments for one voucher → exactly one succeeds.
- Unverified scale under BLOCK → 422; under WARN → allowed with warning.

**Open questions (defaults used if unanswered):** who verifies (default Quality Inspector); quality rejection thresholds (default none — inspector decides); scale tolerance (default UNSET — manual PASS/FAIL); partial payments (default no); one lot per voucher vs daily merge (default one per voucher).

**Delivered**
- **Migration `0013_procurement_reference_data.sql`:** coffee type `RED_CHERRY`, parchment grades G1/G2, `scale_calibrations.tolerance_kg` nullable (no tolerance while the setting is UNSET), payment queue index.
- **Domain (pure, unit-tested):** `purchase-calculator`, `voucher-state-machine`, `payment-state-machine`, `quality-rules` (rule evaluator + percent sum), `scale-verification`, `business-time` (backdate limit).
- **Shared services:** `CashLedgerService` (only writer of `cash_transactions`, mirror reversals), `LotService` (root lot + `PURCHASED` event, event spine, `assertNotOnHold` over the lot's ancestors for Phase 3), `CorrectiveActionsService.raise()` (used by failed calibrations; full CA workflow in Phase 7).
- **Modules:** `suppliers`, `quality` (inspections, rules, grades, coffee types, holds), `equipment` (equipment, maintenance, schedules, scales + verification), `purchasing` (+ PDF, dashboard summary), `payments`, `finance` (cash ledger part). 39 new endpoints, all in Swagger and in the authorization matrix.
- **Job:** `calibration-due` hourly (logs scales needing verification until notifications arrive in Phase 7).
- **Frontend:** Suppliers (list, profile, documents upload, status, history), Quality (inspection form with live sum, holds, rules & grades), Scales (status board, daily check, history), Equipment (register, maintenance, schedules), Purchasing (list, tablet weighing form with exact decimal previews, voucher page with approval bar, PDF, prepare payment), Payments (approval / pay-out queues, reversal, cash ledger with funding / return), dashboard KPI cards.

**Decisions taken while building (reversible)**
- Reversing a payment returns the voucher from PAID to APPROVED (it can then be paid again or voided); voiding closes its lot. ARCHITECTURE §9.2 updated.
- The paying cashier is whoever disburses; SoD is checked against the payment approver and the voucher's weighing clerk at that moment (and by `ck_payment_sod` / `ck_pv_sod`).
- A scale that is OUT_OF_SERVICE or failed its last check is blocked even under `scale.unverifiedPolicy = WARN` (WARN only covers missing / expired verification).
- A cancelled voucher still consumes its inspection (DB unique); a new inspection is needed.
- Automatic CAs use `ca.defaultDueDays`, or 7 days while it is UNSET.
- Voucher edits (`PUT /purchases/:id`) are API-only for now; the UI cancels and re-creates a draft.
- Windows: the Jest global setup now runs tsx through node (`node_modules/.bin/tsx` is a `.cmd` shim there).

**Exit (met):** 163 backend tests (84 unit + 79 integration incl. the full procurement scenario, SoD, parallel payments, BLOCK/WARN, holds, reversal/void) + 13 frontend tests green; typecheck, lint, both builds and OpenAPI generation pass; server + worker start on a migrated database.

---

## Phase 3 — Wet processing ✅

**Goal:** track each lot from hopper to grade lots, with reconciliation.

**Modules:** `lots`, `hopper`, `pulping`, `fermentation`, `washing`, `grading`; shared `LotEventService`.

**Tables:** lots, lot_events, hoppers, hopper_records, hopper_reconciliations, pulping_machines, pulping_machine_inspections, pulping_records, fermentation_tanks, fermentation_batches, fermentation_measurements, washing_records, grading_records, grade_outputs.

**Features & rules**
1. **LotEventService** — the only way to change `current_stage`; validates the stage machine PURCHASED → HOPPER → FLOTATION → PULPING → FERMENTATION → WASHING → GRADING; appends event; bumps version; blocked by active quality hold.
2. **Hopper intake** — lot PURCHASED, not on hold; hopper operational; capacity warning; event `HOPPER_RECEIVED`.
3. **Flotation** — floaters + sinkers vs intake within `hopper.flotationBalanceTolerancePct` (0 = strict); event `FLOTATION_COMPLETED`; imbalance → CA recommendation.
4. **Daily hopper reconciliation** — purchased vs intake per day; `diff% > hopper.reconciliationTolerancePct` → DISCREPANCY + CA; Site Manager review; runs at `hopper.reconciliationRunTime` or manually.
5. **Pulping** — machine OPERATIONAL; today's machine inspection (disc teeth, spacing, cleaning) PASS per `pulping.dailyInspectionPolicy` (BLOCK/WARN + CA); output ≤ input; event `PULPED`.
6. **Fermentation** — tank free (DB partial unique); duration window from settings (24–48 h [MANUAL]) snapshotted; measurements (temp, pH, sweetness, acidity, mucilage); early completion needs reason; completion requires mucilage COMPLETE (setting); events `FERMENTATION_STARTED/COMPLETED`.
7. **Washing** — fermentation completed; output ≤ input; event `WASHED`.
8. **Grading** — Σ grade outputs ≤ washed output (+ `grading.outputTolerancePct`); one **child lot per grade** (`<lot>-<grade>`), parent status SPLIT; events `GRADED` + `LOT_SPLIT`.
9. **Lot views** — list, detail, event timeline, outturn so far.

**Endpoints:** `/lots` (+ `/events`, `/outturn`), `/hopper/intakes` (+ `/flotation`), `/hopper/reconciliations/run`, `/hopper/reconciliations/:id/review`, `/pulping/machines/:id/inspections`, `/pulping/records` (+ `/complete`), `/fermentation/batches` (+ `/measurements`, `/complete`), `/washing/records`, `/grading/records`.

**Frontend:** Lots (list, lot page with timeline), Wet processing board (lots per stage), hopper & flotation forms, reconciliation review, machine daily check, fermentation tank board with countdown, washing & grading forms.

**Jobs:** `fermentation-monitor` (every 5 min: approaching/overdue) + a delayed job per batch; `hopper-reconciliation` (daily); `maintenance-due` (daily).

**Exit gate:** integration Lot → hopper → flotation → pulping → fermentation → washing → grading (child lots, weights conserved); hold blocks every step; tank double-booking impossible; reconciliation flags discrepancies.

**Delivered**
- **No new migration** — all Phase 3 tables, the one-active-batch-per-tank index and the output ≤ input checks already existed (0005, 0011).
- **Domain (pure, unit-tested):** `core/lots/lot-stage.ts` (stage machine; only ACTIVE lots move), `processing/domain/wet-rules.ts` (flotation balance, reconciliation, machine check, fermentation window, grading limit, outturn %; tolerances are compared on exact values and rounded only for display).
- **Shared services:** `LotService.lockForStep()` + `advance()` — the only way to change `lots.current_stage` (checks stage, status and holds on the lot and its ancestors, appends the stage event); `CorrectiveActionsService.raiseOrRecommend()` following `controls.correctiveActionMode`.
- **Modules:** `lots` (list, board, detail, timeline incl. ancestors, outturn), `processing` (hoppers / pulping machines / tanks registry, hopper intake + flotation, reconciliation run / review, pulper inspections, pulping, fermentation start / measure / complete, washing, grading). 23 new endpoints.
- **Jobs:** `fermentation-monitor` (every 5 min), `hopper-reconciliation` (daily at `hopper.reconciliationRunTime`), `maintenance-due` (daily) — they log until notifications arrive in Phase 7.
- **Frontend:** Lots (list), lot page (status, grade lots, outturn bars, timeline), Wet processing (stage board with the next-step action on each lot card, fermentation tank cards with elapsed hours and window state, pulper daily checks, reconciliation run / detail / review, setup of hoppers, pulpers and tanks), dashboard card "lots in wet processing".

**Decisions taken while building (reversible)**
- Floaters are recorded as a quantity only (open question 7); sinkers continue and become the lot weight.
- Reconciliation groups lots by hopper intake day (station timezone). A day is DISCREPANCY when the day total **or any single lot** is out of tolerance. Re-running replaces the figures until the day is REVIEWED; only a new discrepancy raises / recommends a CA. The nightly job only signals (no CA without a user).
- Corrective actions for flotation imbalance, reconciliation discrepancy, pulping without a passing inspection (WARN policy) and overdue fermentation follow `controls.correctiveActionMode`: RECOMMEND (default) emits `corrective-action.recommended`, AUTO_CREATE opens the CA.
- Pulping can be recorded in one step (with output) or opened and completed later; fermentation needs a completed run. Tank capacity is a hard limit (422); hopper capacity only warns.
- Fermentation expected duration defaults to `fermentation.minHours` and must lie within the window; batches cannot be cancelled yet.
- Grading: child lots `<lot>-<grade>` (format `numbering.formats.LOT_CHILD`) keep the root cherry weight; the parent becomes SPLIT and leaves the board; a grade lot timeline shows its parent history first.
- Changing `hopper.reconciliationRunTime` takes effect at the next worker start.
- Outbox relay tests now drain the queue (they depended on how many events other test files left pending).

**Exit (met):** 142 backend tests (incl. the full wet-processing scenario, stage order, holds at intake and pulping, BLOCK/WARN pulper policy, parallel tank booking, flotation CA in both modes, overdue fermentation, reconciliation run / review / lock) + 15 frontend tests green; typecheck, lint, both builds, OpenAPI (90 paths) pass; server + worker start.

---

## Phase 4 — Drying 🔜

**Goal:** control drying beds and moisture until coffee is fit for the warehouse.

**Modules:** `drying`, `moisture`, `defects`.

**Tables:** drying_beds, drying_batches, drying_batch_beds, raking_records, moisture_records, defect_types, defect_records (workers table referenced; worker screens in Phase 6).

**Features & rules**
1. **Beds** — unique painted code, QR, capacity, status machine AVAILABLE → LOADED → DRYING → READY → AVAILABLE; maintenance/out-of-service only when empty.
2. **Drying batches** — from a grade (child) lot at GRADING; assign one or more beds (one active batch per bed — DB partial unique; Σ loaded ≤ capacity); start → event `DRYING_STARTED`.
3. **Raking** — records per bed; monitor interval `drying.rakingIntervalMinutes` (30 [MANUAL]) within `drying.activeHours`.
4. **Moisture** — classify BELOW/WITHIN/ABOVE vs 10.5–11.5 % [MANUAL] (snapshotted); update batch current moisture; out-of-range → alert; event `MOISTURE_CHECK`.
5. **Defects** — by type and source; cumulative % vs `defect.correctiveActionThresholdPct` → CA; event `DEFECT_RECORDED`.
6. **Final moisture verification** — latest reading within target, taken within `moisture.finalVerificationMaxAgeHours`, by `drying:final-verify`; batch VERIFIED, lot `FINAL_MOISTURE_VERIFIED`.
7. **Capita scope** — CAPITA records raking/defects only for their own group (scope policy).

**Endpoints:** `/drying/beds`, `/drying/batches` (+ `/start`, `/assign-bed`, `/unload-bed`, `/final-verify`), `/drying/raking`, `/moisture/records`, `/defects`, `/defects/types`.

**Frontend (mobile-first):** bed map/board with status colours, scan bed QR → quick actions, moisture entry, raking log, defect entry, batch page with moisture chart, final verification screen.

**Jobs:** `raking-monitor` (every 5 min, active hours only).

**Exit gate:** moisture classification tests; final verification refuses stale or out-of-range readings; bed cannot hold two batches; capita scope enforced; mobile walkthrough on a phone.

---

## Phase 5 — Warehouse & traceability ⬜

**Goal:** receive dry parchment into stock, keep an exact ledger, and trace any bag back to the farmer.

**Modules:** `warehouse`, `inventory`, `traceability`, `qr`; shared `InventoryLedgerService`.

**Tables:** warehouses, warehouse_sections, warehouse_stacks, inventory_items, store_receive_vouchers, stock_balances, bin_cards, inventory_transactions, stock_transfers.

**Features & rules**
1. **Structure** — warehouses → sections → stacks (stack QR).
2. **SRV (store receive voucher)** — batch VERIFIED; **moisture ≤ `moisture.warehouseMaxPct` (11.5 % [MANUAL]) else 422 `MOISTURE_ABOVE_WAREHOUSE_LIMIT`**; Σ SRV weights ≤ batch final weight; deliverer ≠ receiver; approver ∉ {deliverer, receiver}; manager approval [MANUAL]; approval posts stock IN + bin card entry, lot → WAREHOUSE / IN_STORE, beds released; event `WAREHOUSE_RECEIVED`; SRV PDF.
3. **Inventory ledger** — only writer; row lock; never negative; `balance_after` on every line; reversal = mirror line (cannot reverse twice).
4. **Transfers** — request → approve (approver ≠ requester) → OUT + IN in one transaction; event `TRANSFERRED`.
5. **Adjustments** — reason + approval (`inventory.adjustmentRequiresApproval`); size vs `inventory.discrepancyCaThresholdPct` → CA (`INVENTORY_DISCREPANCY` / `MISSING_STOCK`).
6. **Bin cards** — per item/lot/grade/stack; printable PDF.
7. **Traceability** — backward trace (lot → root → voucher → inspection → weighings → scale calibration → payment → supplier) and forward trace (→ batches, beds, moisture → SRV → stock → release); lot passport page (PDF in Phase 8).
8. **QR resolver** — `/q/:token` for supplier, lot, bed, batch, stack, SRV (login required).
9. **Integrity checks** — nightly: events vs records, child weights vs parent, balances vs ledger sums.

**Endpoints:** warehouse structure CRUD, `/warehouse/srvs` (+ `/submit`, `/approve`, `/reject`, `/cancel`, `/pdf`), `/inventory/balances`, `/inventory/transactions` (+ `/reverse`), `/inventory/bin-cards/:id` (+ `/pdf`), `/inventory/transfers` (+ approve/reject), `/inventory/adjustments` (+ approve), `/lots/:id/trace`, `/qr/:token`, `/qr/:type/:id/image.png`.

**Frontend:** warehouse layout, SRV forms + approval, stock by stack/lot/grade, bin card view, transfer & adjustment workflows, **lot passport** (timeline + trace tree), QR scanner page.

**Jobs:** `integrity-check` (nightly).

**Exit gate:** SRV above 11.5 % blocked; ledger never negative under parallel issues; balances equal ledger sums; full backward + forward trace for a test lot.

---

## Phase 6 — Workforce ⬜

**Goal:** manage temporary workers, capitas, attendance, pay and rations.

**Modules:** `workers`, `attendance`, `payroll`, `rations` (+ scope policy).

**Tables:** worker_roles, workers, worker_groups, worker_assignments, attendances, payrolls, payroll_items, ration_items, store_issue_vouchers, store_issue_voucher_lines, ration_issues.

**Features & rules**
1. **Workers & groups** — worker roles with default daily rate; workers (rate override); groups led by a capita; group size warning outside 20–30 [MANUAL approx.]; assignments to beds/areas.
2. **Attendance** — bulk by group/day (capita for own group); one record per worker per day; approval (approver ≠ recorder); signature/thumbprint upload.
3. **Payroll** — generate from approved, unpaid attendance in the period; `total = days × daily rate` [MANUAL]; DRAFT → SUBMITTED → SUPERVISOR_APPROVED → CASHIER_APPROVED → PAID; SoD (supervisor ≠ preparer; cashier ∉ {preparer, supervisor}); worker confirmation before PAID (setting); cash ledger entry; attendance marked paid (no double pay); payroll sheet PDF.
4. **Rations / SIV** — request (capita for own group) → approve (≠ requester) → issue (stock OUT via ledger) → ration issue records.
5. **Self-service** — TEMP_WORKER sees own attendance and pay; CAPITA sees own group.

**Endpoints:** `/workers`, `/worker-roles`, `/worker-groups`, `/workers/assignments`, `/attendance` (bulk), `/attendance/approve`, `/attendance/:id/confirmation`, `/payroll` (+ `/submit`, `/approve-supervisor`, `/approve-cashier`, `/pay`, `/cancel`, `/pdf`), `/payroll/items/:id/confirmation`, `/rations/items`, `/rations/sivs` (+ submit/approve/issue/cancel).

**Frontend:** worker register, group view, mobile attendance sheet (tap present/absent), payroll preparation & approval chain, pay-out screen with confirmation capture, ration requests & issue.

**Exit gate:** payroll calculation tests; full approval chain + SoD; no worker paid twice for a day; scope tests (capita/own group, worker/self); SIV issue moves stock.

---

## Phase 7 — Controls ⬜

**Goal:** money control, audits, corrective actions and live notifications.

**Modules:** `finance` (expenses, summaries), `audits`, `corrective-actions`, `notifications`.

**Tables:** expense_categories, expenses, cash_transactions, audits, audit_items, corrective_actions, corrective_action_evidence, notifications, outbox_events.

**Features & rules**
1. **Expenses** — DRAFT → PENDING_APPROVAL → APPROVED → PAID (cash ledger); approver ≠ requester; receipt upload.
2. **Cash** — funding/returns; period summaries (opening, in, out, closing).
3. **Audits** — plan, perform, close; checklist items by area; NON_COMPLIANT → corrective action automatically; **unannounced audits** generated per `audit.unannouncedFrequency` / areas, hidden from SITE_MANAGER until started.
4. **Corrective actions** — OPEN → IN_PROGRESS → RESOLVED → VERIFIED → CLOSED (reopen on failed verification); evidence upload; verifier ≠ responsible; `CorrectiveActionsService.raise()` wired to all triggers from Phases 2–6 per `controls.correctiveActionMode`.
5. **Notifications** — rules map domain events → recipients by permission; in-app (live via SSE + PostgreSQL LISTEN/NOTIFY), email adapter (off by setting), SMS interface; dedupe keys; read/unread; bell in the app bar.
6. **Approval inbox** — one page listing everything waiting for the current user's approval.

**Endpoints:** `/finance/expenses` (+ approve/pay), `/finance/cash`, `/finance/summary`, `/audits` (+ `/start`, `/complete`, `/close`, `/items`, `/unannounced/generate`), `/corrective-actions` (+ `/start`, `/resolve`, `/verify`, `/close`, evidence), `/notifications` (+ `/read`, `/read-all`, `/stream`).

**Jobs:** `ca-overdue` (daily), `approvals-digest` (hourly), unannounced-audit generator, notification dispatch; all monitors from Phases 2–4 now send real notifications.

**Exit gate:** every CA trigger creates/recommends a CA; notification tests (recipients, dedupe, no alert for rolled-back work); audit visibility rules; expense SoD.

---

## Phase 8 — Reporting ⬜

**Goal:** the reports and dashboards management needs, exportable.

**Module:** `reports` (read-only query services) + `report_jobs`.

**Features**
1. **Daily:** cherry purchased, expenditure, funds disbursed, hopper intake, floaters, sinkers, washed, Grade 1/2, beds in use, moisture, warehouse receipts.
2. **Weekly:** revenue/expenditure, outturn, temporary labour, warehouse balance, quality stats, production stats.
3. **Monthly:** purchasing, production, inventory, finance, payroll, expenses, yield, quality, supplier stats.
4. **Yield/outturn:** by lot, supplier, day, week, month, grade (`final parchment kg / original cherry kg × 100`).
5. **Filters:** date range, lot, supplier, grade, status.
6. **Exports:** PDF (PDFKit) and Excel (ExcelJS) generated by a pg-boss job, stored as documents, download link notification; lot passport PDF.
7. **Dashboards:** role-specific KPI cards and charts.

**Endpoints:** `/reports/daily|weekly|monthly/...`, `/reports/yield`, `/reports/exports` (+ `/:id`).

**Frontend:** report pages with filters, charts, export buttons; dashboards per role.

**Exit gate:** report totals reconcile with ledgers in tests; exports open correctly in PDF reader/Excel; Playwright smoke test of main user journeys.

---

## Phase 9 — Production readiness & go-live ⬜

**Goal:** safe, observable, recoverable production on Render.

1. **Security review** — dependency audit, headers, CORS, cookie mode, secrets, permission matrix sign-off, pen-test checklist.
2. **Performance** — seed realistic season volume; `EXPLAIN ANALYZE` slow queries (pgAdmin); add indexes / materialised daily summaries if needed; load test key endpoints.
3. **Data safety** — Render PostgreSQL backups/PITR plan, nightly `pg_dump` to S3, **restore drill**, bucket versioning.
4. **Monitoring** — log forwarding, uptime check on `/health/ready`, failed-job/dead-letter view for SUPER_ADMIN.
5. **Render production** — paid always-on Web Service (or separate Background Worker), production database plan, custom domain (`app.` / `api.` → cookie `SameSite=Strict`), environment groups for staging/production.
6. **Settings sign-off** — every PROVISIONAL / UNSET setting confirmed by the Site Manager (banner empty).
7. **Documentation & training** — RUNBOOK.md (deploy, rollback, restore), SETTINGS.md, BACKUP.md, user guides per role, training session.
8. **Go-live** — data migration of opening balances (stock, suppliers, workers), cut-over date, hyper-care period.

**Exit gate:** go-live checklist signed; restore drill passed; all settings confirmed.

---

## Deployment path (applies from Phase 2 onward)

| Environment | Where | When |
|---|---|---|
| Local | Your PC (Phase 0 steps) | Always |
| Staging | Render (Blueprint instance "staging"), free/low plans acceptable | After each phase's exit gate |
| Production | Render (paid plans, custom domain) | Phase 9 go-live |

Render deploys automatically from `main` after CI passes; each deploy runs migrations and the idempotent seed before starting the API.

---

## Access model (current)

- **One role: SUPER_ADMIN, holding every permission** (decision of 2026-10-02). The other ten roles of ARCHITECTURE.md §7 were removed from the catalog and from existing databases (migration `0014_single_super_admin.sql`); they are added back only when requested.
- **Segregation of duties removed** — service checks deleted and DB `ck_*_sod` constraints dropped. One super admin can create, verify, approve and pay the same voucher. Every action is still recorded in the hash-chained audit log.
- Permission codes remain on every route, so adding roles later needs only catalog entries (and UI role pickers already load roles from the API).
- Tests check denial with throwaway roles (`createRole()` test helper) instead of the old matrix roles.
- Any SoD-related text in the phases above ("approver ≠ requester", SoD tests in exit gates) no longer applies until SoD is reintroduced; the Phase 1–2 sections describe what was built at the time.

## Decisions still needed (collected)

| # | Question | Needed by | Default if unanswered |
|---|---|---|---|
| 1 | Operations manual (to reconcile rules/forms) | Phase 2 | Brief-based rules, PROVISIONAL settings |
| 2 | Who verifies purchase vouchers | Phase 2 | Quality Inspector verifies, Site Manager approves |
| 3 | Quality rejection thresholds | Phase 2 | None; inspector decides |
| 4 | Scale verification tolerance (kg) | Phase 2 | UNSET; manual PASS/FAIL |
| 5 | Partial payments per voucher | Phase 2 | Not supported |
| 6 | One lot per voucher or daily merged lots | Phase 2–3 | One lot per voucher |
| 7 | What happens to floaters | Phase 3 | Recorded as quantity only |
| 8 | Final moisture verification authority | Phase 4 | Quality Inspector or Drying Supervisor |
| 9 | `moisture.finalVerificationMaxAgeHours` value | Phase 4 | Must be set before first final verification |
| 10 | Revenue / sales module | Phase 8 | Revenue = recorded cash inflows only |
| 11 | Render plan, S3 provider, custom domain | Phase 9 (staging earlier) | Starter plans, Cloudflare R2, onrender.com hosts |
| 12 | Currency & timezone | Phase 2 | ETB, Africa/Addis_Ababa |
