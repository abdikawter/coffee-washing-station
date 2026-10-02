/**
 * Roles and permissions — the seed source for `roles`, `permissions` and
 * `role_permissions`.
 *
 * Current setup: ONE role, SUPER_ADMIN, which holds every permission code and
 * controls the whole system. The operational roles of the design matrix
 * (ARCHITECTURE.md §7: Site Manager, Quality Inspector, Purchasing Clerk, …)
 * are added here again when the business asks for them.
 *
 * Code checks PERMISSION CODES, never role names, so adding roles later needs
 * no change to the modules. The seed only inserts rows that are missing (a new
 * role gets its full default set; a new permission is granted to the roles
 * listed here); it never re-grants something an administrator removed.
 */

export const ROLE_CODES = ['SUPER_ADMIN'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLES: Record<RoleCode, { name: string; description: string }> = {
  SUPER_ADMIN: { name: 'Super Administrator', description: 'Controls everything: every module, every action, users, roles and settings.' },
};

/** module:action → description. Module = text before the colon. */
export const PERMISSIONS: Record<string, string> = {
  // Users & roles
  'user:read': 'View users and employees',
  'user:manage': 'Create/update/deactivate users, assign roles, manage employees',
  'role:read': 'View roles and permissions',
  'role:manage': 'Change which permissions a role has',
  // Settings & audit log
  'settings:read': 'View system settings',
  'settings:manage': 'Change business settings (thresholds, policies) — reason required',
  'settings:manage-system': 'Change system settings (auth, numbering, notifications)',
  'auditlog:read': 'View and verify the audit log',
  // Files
  'file:upload': 'Upload documents (IDs, receipts, evidence, signatures)',
  'file:read': 'Download any stored document (otherwise only own uploads)',
  // Suppliers
  'supplier:read': 'View suppliers',
  'supplier:create': 'Register suppliers',
  'supplier:update': 'Update supplier details and documents',
  'supplier:status': 'Change supplier status (activate/suspend/deactivate)',
  // Quality
  'quality:read': 'View quality inspections',
  'quality:inspect': 'Record cherry quality inspections',
  'quality:hold-read': 'View quality holds',
  'quality:hold': 'Place a quality hold on a lot',
  'quality:hold-release': 'Release a quality hold',
  'quality:rules-read': 'View quality rules and grades',
  'quality:rules-manage': 'Manage quality rules and grades',
  // Scales
  'scale:read': 'View scales and calibration history',
  'scale:verify': 'Record daily scale verification / calibration',
  'scale:manage': 'Manage scales',
  // Purchasing
  'purchase:read': 'View purchase vouchers',
  'purchase:create': 'Create purchase vouchers with weight records',
  'purchase:update': 'Edit draft purchase vouchers',
  'purchase:submit': 'Submit purchase vouchers for verification',
  'purchase:verify': 'Verify purchase vouchers (grade/weights)',
  'purchase:return': 'Return a pending/verified voucher to draft for correction',
  'purchase:approve': 'Approve purchase vouchers',
  'purchase:cancel': 'Cancel draft/pending purchase vouchers',
  'purchase:void': 'Void approved/paid purchase vouchers',
  // Payments
  'payment:read': 'View supplier payments',
  'payment:create': 'Prepare supplier payments',
  'payment:approve': 'Approve or reject supplier payments',
  'payment:disburse': 'Disburse (pay out) approved supplier payments',
  'payment:reverse': 'Reverse a paid supplier payment',
  // Lots
  'lot:read': 'View lots, events and traceability',
  'lot:lookup': 'Look up a lot by number or QR (summary only)',
  // Hopper
  'hopper:read': 'View hopper and flotation records',
  'hopper:record': 'Record hopper intake and flotation',
  'reconciliation:read': 'View hopper reconciliations',
  'reconciliation:run': 'Run the hopper reconciliation',
  'reconciliation:review': 'Review reconciliation discrepancies',
  // Pulping & equipment
  'pulping:read': 'View pulping records and machine checks',
  'pulping:record': 'Record pulping and daily machine inspections',
  'equipment:read': 'View equipment and maintenance',
  'equipment:maintenance-record': 'Record maintenance performed',
  'equipment:manage': 'Manage equipment and maintenance schedules',
  // Fermentation, washing, grading
  'fermentation:read': 'View fermentation batches',
  'fermentation:record': 'Start, measure and complete fermentation',
  'fermentation:assess': 'Record fermentation quality assessment',
  'washing:read': 'View washing and grading records',
  'washing:record': 'Record washing',
  'grading:record': 'Record grading (creates grade lots)',
  // Drying
  'drying:read': 'View drying beds and batches',
  'drying:record': 'Create/update drying batches, assign/unload beds',
  'drying:manage': 'Manage drying beds',
  'drying:final-verify': 'Perform final moisture verification',
  'moisture:read': 'View moisture records',
  'moisture:record': 'Record moisture readings',
  'raking:read': 'View raking records',
  'raking:read-own-group': 'View raking records of own group',
  'raking:record': 'Record raking',
  'raking:record-own-group': 'Record raking for own group',
  'defect:read': 'View defect records',
  'defect:read-own-group': 'View defect records of own group',
  'defect:record': 'Record defect picking',
  'defect:record-own-group': 'Record defect picking for own group',
  // Warehouse & inventory
  'warehouse:read': 'View warehouses, sections, stacks',
  'warehouse:update': 'Update stacks and sections',
  'warehouse:manage': 'Create and manage warehouses',
  'srv:read': 'View store receive vouchers',
  'srv:deliver': 'Create SRV as deliverer (drying side)',
  'srv:receive': 'Create/confirm SRV as receiver (store side)',
  'srv:approve': 'Approve or reject SRVs',
  'inventory:read': 'View stock balances, ledger and bin cards',
  'inventory:transfer-request': 'Request stock transfers',
  'inventory:transfer-approve': 'Approve stock transfers',
  'inventory:adjust': 'Request stock adjustments',
  'inventory:adjust-approve': 'Approve stock adjustments',
  'inventory:reverse': 'Reverse an inventory transaction',
  // Workforce
  'worker:read': 'View all workers and groups',
  'worker:read-own-group': 'View workers of own group',
  'worker:read-self': 'View own worker record',
  'worker:write': 'Create/update workers and assignments',
  'worker:manage': 'Manage worker roles, rates and groups',
  'attendance:read': 'View all attendance',
  'attendance:read-own-group': 'View attendance of own group',
  'attendance:read-self': 'View own attendance',
  'attendance:record-own-group': 'Record attendance for own group',
  'attendance:approve': 'Approve attendance',
  'payroll:read': 'View payrolls',
  'payroll:read-own-group': 'View payroll lines of own group',
  'payroll:read-self': 'View own payroll lines',
  'payroll:prepare': 'Prepare payroll from approved attendance',
  'payroll:approve-supervisor': 'Supervisor approval of payroll',
  'payroll:approve-cashier': 'Cashier approval of payroll',
  'payroll:pay': 'Pay payroll',
  'siv:read': 'View store issue vouchers and rations',
  'siv:request': 'Request store issues (SIV)',
  'siv:request-own-group': 'Request rations for own group',
  'siv:approve': 'Approve store issues',
  'siv:issue': 'Issue goods against an approved SIV',
  // Finance
  'expense:read': 'View expenses',
  'expense:create': 'Record expenses',
  'expense:approve': 'Approve or reject expenses',
  'expense:pay': 'Pay approved expenses',
  'cash:read': 'View cash transactions and summaries',
  'cash:record': 'Record cash funding and returns',
  // Audits & corrective actions
  'audit:read': 'View audits (excluding unannounced schedule)',
  'audit:read-unannounced': 'View the unannounced audit schedule',
  'audit:manage': 'Plan, perform and close audits',
  'ca:read': 'View all corrective actions',
  'ca:read-assigned': 'View corrective actions assigned to me',
  'ca:create': 'Raise corrective actions',
  'ca:update': 'Update any corrective action',
  'ca:update-assigned': 'Update corrective actions assigned to me',
  'ca:verify': 'Verify resolved corrective actions',
  'ca:close': 'Close verified corrective actions',
  // Reports
  'report:procurement': 'Purchasing & supplier reports',
  'report:quality': 'Quality reports',
  'report:production': 'Production & yield reports',
  'report:drying': 'Drying reports',
  'report:warehouse': 'Warehouse & inventory reports',
  'report:workforce': 'Workforce & payroll reports',
  'report:finance': 'Finance reports',
  'report:export': 'Export reports to PDF/Excel',
};

export type PermissionCode = keyof typeof PERMISSIONS;

/** SUPER_ADMIN holds every permission code (new codes are granted to it by the seed automatically). */
export const ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  SUPER_ADMIN: Object.keys(PERMISSIONS),
};

export function permissionModule(code: string): string {
  return code.split(':')[0]!;
}
export function permissionAction(code: string): string {
  return code.split(':').slice(1).join(':');
}
