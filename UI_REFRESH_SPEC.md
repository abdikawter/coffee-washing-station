# UI Refresh — Design Spec (for Claude Code)

> Put this file at `docs/UI_REFRESH_SPEC.md`. Do this refresh **before Phase 4**; every later phase uses the same theme, components and page templates.
> Stack stays the same: React + TypeScript + Vite + **MUI** (+ MUI X). No Tailwind, no second UI library.

## 1. Goal

A modern, consistent, coffee-themed interface that is pleasant on desktop and practical on phones/tablets in the field (sunlight, gloves, slow network). Same features — new look and better layouts.

## 2. Design tokens (one source: `frontend/src/theme/`)

### 2.1 Colour palette
| Token | Light | Dark | Use |
|---|---|---|---|
| `primary` | `#4E342E` (roasted coffee) | `#D7B8A8` | App bar, primary buttons, links |
| `secondary` | `#B23A2E` (coffee cherry) | `#E57368` | Accents, highlights, key numbers |
| `background.default` | `#F7F3EE` (parchment) | `#1A1512` | Page background |
| `background.paper` | `#FFFFFF` | `#241D19` | Cards, tables, dialogs |
| `success` | `#2E7D32` (leaf) | `#66BB6A` | Done, PASS, within target |
| `warning` | `#ED8B00` (amber) | `#FFB74D` | Waiting, near limit |
| `error` | `#C62828` | `#EF5350` | Rejected, overdue, out of range |
| `info` | `#1565C0` | `#64B5F6` | In progress |
| `text.primary / secondary` | `#2B211D` / `#6D5F57` | `#F3ECE7` / `#BCAEA5` | |
| `divider` | `#E8DFD7` | `#3A302A` | |

**Status meaning is fixed everywhere** (chips, badges, map colours, chart series):
- green = done / passed / within target
- amber = waiting / approaching a limit
- red = rejected / overdue / out of range / blocked
- blue = in progress
- grey = cancelled / inactive

Map every enum status to one of these in `theme/status.ts` (e.g. `PurchaseVoucherStatus.APPROVED → success`, `PENDING_VERIFICATION → warning`).

### 2.2 Typography
- Latin: **Inter** (fallback: system-ui). Amharic: **Noto Sans Ethiopic**. Load both via `@fontsource/*` packages (bundled — no Google Fonts call, works offline).
- `fontFamily: '"Inter", "Noto Sans Ethiopic", system-ui, sans-serif'`.
- Scale: h4 28/600 (page titles), h5 22/600, h6 18/600, body1 15, body2 14, caption 12. KPI numbers: 32/700 with `font-variant-numeric: tabular-nums`.
- All numbers in tables right-aligned and tabular.

### 2.3 Shape, spacing, elevation
- 8 px spacing grid; page padding 24 desktop / 16 mobile.
- Border radius: 12 cards/dialogs, 8 inputs/buttons, 999 chips.
- Cards: 1 px `divider` border, **no shadow**; shadow only on menus/dialogs/drawers.
- Buttons: no uppercase, min height 40 (desktop) / 48 (field screens).

### 2.4 Modes
- Light (default), Dark, and **High-contrast** (outdoor) — switch in the user menu, remembered per user (localStorage).
- MUI `cssVariables` + `colorSchemes`; high-contrast = stronger text, thicker borders, no subtle greys.

## 3. Libraries to add (frontend)
- `@mui/x-data-grid` — all list pages.
- `@mui/x-charts` — KPI sparklines and charts.
- `@mui/x-date-pickers` + `dayjs` — date and range pickers.
- `@fontsource/inter`, `@fontsource/noto-sans-ethiopic`.
Use the free (MIT) editions only unless the owner approves a licence.

## 4. Shared components (`frontend/src/components/`)

Build these once; pages must use them instead of ad-hoc markup.

| Component | Purpose |
|---|---|
| `PageHeader` | Title, subtitle, breadcrumbs, primary/secondary actions; sticky on scroll |
| `KpiCard` | Label, big number + unit, change vs previous period (▲/▼ coloured), optional sparkline, click-through link |
| `StatusChip` | Takes an enum value → colour + label from `theme/status.ts` (+ Amharic label later) |
| `DataTable` | Wrapper around MUI X DataGrid: server-side pagination/sort/filter matching the API (`page`, `pageSize`, `sort`), toolbar (search, filters, column picker, density, export CSV), row click → detail, empty state |
| `FilterBar` | Date range, status, supplier, etc.; syncs with URL query string |
| `EmptyState` | Illustration + message + action button ("No vouchers yet — Create voucher") |
| `JourneyStepper` | Horizontal lot stages (Purchased → … → Warehouse) with current stage, weights and dates; vertical on mobile |
| `Timeline` | Vertical event list (lot events, approvals, audit trail) |
| `ProgressRing` | Circular progress with label (fermentation hours, moisture) and status colour |
| `ApprovalBar` | Sticky bottom bar on documents: shows allowed actions (Submit / Verify / Approve / Reject) based on permission + state; reason dialog built in |
| `MoneyText`, `WeightText`, `PercentText` | Format decimal strings (ETB, kg, %) consistently |
| `ConfirmDialog`, `ReasonDialog` | Existing; restyle |
| `FieldScreen` | Layout for mobile tasks: big title, one task, large inputs, bottom action button |
| `SectionCard` | Card with title + optional actions for grouping form/detail sections |

Each component: typed props, light/dark/high-contrast tested, one Vitest test for behaviour, and a usage example in `docs/ui/COMPONENTS.md` (short).

## 5. Page templates (every page uses one)

1. **List page** — `PageHeader` (title + "New …" button) → `FilterBar` → `DataTable` → optional right `Drawer` quick-view on row click.
2. **Detail page** — summary header card (number, `StatusChip`, key figures, actions) → `Tabs` (Overview, Items, History, Documents) → `Timeline`; `ApprovalBar` at bottom for workflow documents.
3. **Form page** — `SectionCard`s in a 2-column grid (1 column on mobile) or a `Stepper` wizard for long forms; sticky Save/Submit bar; inline validation; unsaved-changes warning.
4. **Field screen (mobile)** — `FieldScreen`: one task, inputs ≥ 48 px tall, numeric keypad for weights/moisture, big confirm button, works one-handed.
5. **Dashboard** — `KpiCard` row → charts row → "Waiting for you" (approvals) + "Alerts" panels.

## 6. App shell
- Left navigation grouped by section (Operations, Warehouse & people, Control, Administration) with icons; collapsible to icons-only on desktop; bottom-sheet/drawer on mobile.
- Top bar: global search (lot / voucher / supplier number — Phase 5 can wire QR), notifications bell (Phase 7), language switch EN/አማ (labels later), theme switch, user menu.
- "Settings to confirm" banner restyled as a slim dismissible bar.
- Login page: split layout — coffee illustration / photo on one side, form on the other (stacked on mobile).

## 7. Screen redesigns for existing modules (Phases 1–3)

Apply the templates to every existing page. Specific visual upgrades:

| Screen | Upgrade |
|---|---|
| Dashboard | KPI row: cherry bought today (kg) vs yesterday, ETB paid today, vouchers awaiting approval, lots in fermentation, open holds. Chart: cherry kg per day (last 14 days) + average price line. Panels: "Waiting for you", "Alerts" (unverified scales, tanks near 48 h, reconciliation discrepancies) |
| Suppliers | DataTable; profile page with header (name, code, QR, status), KPI mini-cards (kg this season, paid, avg quality), quality history chart, tabs (Purchases, Payments, Inspections, Documents) |
| Quality inspection | Form with three % inputs and a live stacked bar (red / green / overripe) + live sum check; rule warnings shown inline |
| Scales | Status board: one card per scale (PASS today / due / out of service) with "Verify now" action |
| Purchase voucher | Tablet-friendly weighing form: large live net weight and total, item lines as cards; detail page with `ApprovalBar` and status timeline (Draft → Verified → Approved → Paid) |
| Payments | Queue grouped by status; disburse dialog with big amount and confirmation |
| Lots | List with stage chips; **lot page with `JourneyStepper`**, weights at each step, outturn so far, event `Timeline` |
| Wet processing | Board view: columns per stage (Hopper, Pulping, Fermentation, Washing, Grading) with lot cards (Kanban style, read-only) |
| Fermentation | One card per tank with `ProgressRing` (hours elapsed vs min/max), colour turns amber near max and red over max; measurements mini-chart |
| Hopper reconciliation | Day card: purchased vs intake bar, difference %, status chip, review action |
| Users / Roles / Settings / Audit log | DataTable + drawers; Settings grouped by category with source chips; Audit log with JSON diff view (before/after side by side, changed keys highlighted) |

## 8. Accessibility & field use
- Contrast ≥ WCAG AA (4.5:1 text) in all modes; high-contrast mode ≥ 7:1.
- Touch targets ≥ 44 px (48 px on field screens); visible focus rings; full keyboard use on desktop.
- Never colour-only: status chips have text, charts have labels.
- Loading: skeletons instead of spinners for tables/cards; optimistic UI only for non-financial actions.
- Works at 360 px width; no horizontal scroll except inside DataTable.

## 9. Rules for all future phases (copy into `CLAUDE.md`)
- Use only the theme tokens — no hard-coded colours, font sizes or shadows in pages.
- Every page uses one of the five templates in §5 and the shared components in §4.
- Statuses always render through `StatusChip` / `theme/status.ts`.
- Numbers through `MoneyText` / `WeightText` / `PercentText`.
- New field tasks use `FieldScreen`.
- Check each new page at desktop (1440) and phone (390) width in light, dark and high-contrast before marking done.

## 10. Process (how Claude Code should work)
1. **Theme first:** tokens, fonts, modes, `status.ts`; screenshot the existing pages to confirm nothing breaks.
2. **Shared components** (§4) with tests.
3. **App shell + login** (§6).
4. **Restyle pages module by module** (§7): Admin pages → Dashboard → Suppliers & Quality & Scales → Purchasing & Payments → Lots & Wet processing.
5. After each step: run typecheck, lint, tests, and take **Playwright screenshots** of the changed pages at 1440 and 390 px in light and dark; review them against this spec (and any mockups in `docs/ui/mockups/`) and fix differences.
6. No backend changes except small read endpoints a dashboard KPI needs (e.g. `GET /dashboard/summary`), which must follow existing conventions (route registry, permission, tests).

## 11. Acceptance criteria
- All existing pages use the new theme, templates and shared components; no hard-coded colours remain (`grep` for `#` colours outside `theme/` returns nothing).
- Light, dark and high-contrast modes work on every page.
- Dashboard, lot journey page, fermentation tank board and purchase weighing form match the descriptions in §7.
- Pages usable at 390 px width; field screens have ≥ 48 px targets.
- Typecheck, lint, all tests green; existing behaviour unchanged (permissions, workflows, validations).
- Playwright screenshots for every page saved under `docs/ui/screenshots/` (desktop + phone, light + dark).
- `CLAUDE.md` contains the §9 rules.
