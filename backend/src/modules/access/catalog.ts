/**
 * Roles and permissions — the seed source for `roles`, `permissions` and
 * `role_permissions`, derived row by row from the role–permission matrix in
 * ARCHITECTURE.md §7.
 *
 * Code checks PERMISSION CODES, never role names, so the SUPER_ADMIN can adjust
 * role_permissions at runtime without code changes. The seed only inserts rows
 * that are missing (new roles get their full default set; new permissions are
 * granted to the roles listed here); it never re-grants something an
 * administrator removed.
 *
 * Scoped variants (…-own-group, …-self, …-assigned) implement the bracketed
 * scope notes of the matrix; services apply the scope filter (ScopePolicy).
 */

export const ROLE_CODES = [
  'SUPER_ADMIN',
  'SITE_MANAGER',
  'QUALITY_INSPECTOR',
  'PURCHASING_CLERK',
  'CASHIER_ACCOUNTANT',
  'PULPING_OPERATOR',
  'DRYING_SUPERVISOR',
  'STOREKEEPER',
  'CAPITA',
  'TEMP_WORKER',
  'AUDITOR',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLES: Record<RoleCode, { name: string; description: string }> = {
  SUPER_ADMIN: { name: 'Super Administrator', description: 'System administration: users, roles, master data, settings.' },
  SITE_MANAGER: { name: 'Site Manager', description: 'Approves vouchers, payments, SRVs, transfers, adjustments; manages business settings.' },
  QUALITY_INSPECTOR: { name: 'Quality Inspector', description: 'Cherry inspection, voucher verification, holds, moisture and grading checks.' },
  PURCHASING_CLERK: { name: 'Purchasing Clerk', description: 'Suppliers, weighing and purchase vouchers.' },
  CASHIER_ACCOUNTANT: { name: 'Cashier / Accountant', description: 'Supplier payments, payroll payment, expenses, cash ledger.' },
  PULPING_OPERATOR: { name: 'Pulping Operator', description: 'Hopper, flotation, pulping, fermentation, washing and grading records.' },
  DRYING_SUPERVISOR: { name: 'Drying Supervisor', description: 'Drying beds and batches, moisture, raking, defects, workers and payroll preparation.' },
  STOREKEEPER: { name: 'Storekeeper', description: 'Warehouse receipts, bin cards, transfers, adjustments and issues.' },
  CAPITA: { name: 'Capita (group leader)', description: 'Leads a worker group: attendance, raking and ration requests for own group.' },
  TEMP_WORKER: { name: 'Temporary Worker', description: 'Optional login to view own attendance and pay.' },
  AUDITOR: { name: 'Auditor', description: 'Read access everywhere; audits, findings and corrective-action verification.' },
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

const ALL_REPORTS = [
  'report:procurement',
  'report:quality',
  'report:production',
  'report:drying',
  'report:warehouse',
  'report:workforce',
  'report:finance',
];

/** All "read" permissions — shared by SUPER_ADMIN (R everywhere) and AUDITOR. */
const READ_EVERYTHING = [
  'user:read', 'role:read', 'settings:read', 'auditlog:read', 'file:read',
  'supplier:read', 'quality:read', 'quality:hold-read', 'quality:rules-read', 'scale:read',
  'purchase:read', 'payment:read', 'lot:read', 'hopper:read', 'reconciliation:read', 'pulping:read',
  'equipment:read', 'fermentation:read', 'washing:read', 'drying:read', 'moisture:read', 'raking:read',
  'defect:read', 'warehouse:read', 'srv:read', 'inventory:read', 'worker:read', 'attendance:read',
  'payroll:read', 'siv:read', 'expense:read', 'cash:read', 'audit:read', 'audit:read-unannounced',
  'ca:read', ...ALL_REPORTS,
];

export const ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  SUPER_ADMIN: [
    ...READ_EVERYTHING,
    'user:manage', 'role:manage', 'settings:manage', 'settings:manage-system', 'file:upload',
    'supplier:create', 'supplier:update', 'supplier:status',
    'quality:rules-manage', 'scale:manage', 'equipment:manage', 'equipment:maintenance-record',
    'drying:manage', 'warehouse:manage', 'warehouse:update', 'worker:manage', 'worker:write',
  ],
  SITE_MANAGER: [
    'user:read', 'role:read', 'settings:read', 'settings:manage', 'auditlog:read', 'file:upload', 'file:read',
    'supplier:read', 'supplier:status',
    'quality:read', 'quality:hold-read', 'quality:rules-read', 'quality:rules-manage',
    'scale:read',
    'purchase:read', 'purchase:return', 'purchase:approve', 'purchase:void',
    'payment:read', 'payment:approve', 'payment:reverse',
    'lot:read', 'hopper:read', 'reconciliation:read', 'reconciliation:review', 'pulping:read',
    'equipment:read', 'equipment:manage', 'equipment:maintenance-record',
    'fermentation:read', 'washing:read',
    'drying:read', 'drying:record', 'drying:manage', 'moisture:read', 'raking:read', 'defect:read',
    'warehouse:read', 'warehouse:update', 'warehouse:manage',
    'srv:read', 'srv:approve',
    'inventory:read', 'inventory:transfer-approve', 'inventory:adjust-approve', 'inventory:reverse',
    'worker:read', 'worker:write', 'worker:manage', 'attendance:read', 'attendance:approve', 'payroll:read',
    'siv:read', 'siv:approve', 'expense:read', 'expense:approve', 'cash:read',
    'audit:read', 'ca:read', 'ca:create', 'ca:update', 'ca:close',
    ...ALL_REPORTS, 'report:export',
  ],
  QUALITY_INSPECTOR: [
    'settings:read', 'file:upload',
    'supplier:read', 'quality:read', 'quality:inspect', 'quality:hold-read', 'quality:hold', 'quality:hold-release',
    'quality:rules-read', 'scale:read', 'scale:verify',
    'purchase:read', 'purchase:verify', 'purchase:return',
    'lot:read', 'hopper:read', 'reconciliation:read', 'pulping:read', 'equipment:read',
    'fermentation:read', 'fermentation:assess', 'washing:read', 'grading:record',
    'drying:read', 'drying:final-verify', 'moisture:read', 'moisture:record', 'raking:read', 'defect:read',
    'srv:read', 'ca:read', 'ca:create', 'ca:update',
    'report:quality', 'report:production',
  ],
  PURCHASING_CLERK: [
    'settings:read', 'file:upload',
    'supplier:read', 'supplier:create', 'supplier:update', 'quality:read', 'scale:read', 'scale:verify',
    'purchase:read', 'purchase:create', 'purchase:update', 'purchase:submit', 'purchase:cancel',
    'payment:read', 'lot:read', 'hopper:read', 'reconciliation:read',
    'ca:read-assigned', 'ca:update-assigned', 'report:procurement',
  ],
  CASHIER_ACCOUNTANT: [
    'settings:read', 'file:upload',
    'supplier:read', 'purchase:read', 'payment:read', 'payment:create', 'payment:disburse', 'lot:read',
    'payroll:read', 'payroll:approve-cashier', 'payroll:pay',
    'expense:read', 'expense:create', 'expense:pay', 'cash:read', 'cash:record',
    'ca:read-assigned', 'ca:update-assigned', 'report:finance', 'report:export',
  ],
  PULPING_OPERATOR: [
    'settings:read', 'file:upload',
    'quality:hold-read', 'lot:read', 'hopper:read', 'hopper:record', 'reconciliation:read', 'reconciliation:run',
    'pulping:read', 'pulping:record', 'equipment:read', 'equipment:maintenance-record',
    'fermentation:read', 'fermentation:record', 'washing:read', 'washing:record', 'grading:record',
    'ca:read-assigned', 'ca:update-assigned', 'report:production',
  ],
  DRYING_SUPERVISOR: [
    'settings:read', 'file:upload',
    'quality:hold-read', 'lot:read', 'equipment:read', 'equipment:maintenance-record',
    'drying:read', 'drying:record', 'drying:final-verify', 'moisture:read', 'moisture:record',
    'raking:read', 'raking:record', 'defect:read', 'defect:record',
    'srv:read', 'srv:deliver',
    'worker:read', 'worker:write', 'attendance:read', 'attendance:approve',
    'payroll:read', 'payroll:prepare', 'payroll:approve-supervisor', 'siv:request',
    'ca:create', 'ca:read-assigned', 'ca:update-assigned', 'report:drying',
  ],
  STOREKEEPER: [
    'settings:read', 'file:upload',
    'quality:hold-read', 'lot:read', 'drying:read', 'moisture:read',
    'warehouse:read', 'warehouse:update', 'srv:read', 'srv:receive',
    'inventory:read', 'inventory:transfer-request', 'inventory:adjust',
    'siv:read', 'siv:request', 'siv:issue',
    'ca:read-assigned', 'ca:update-assigned', 'report:warehouse',
  ],
  CAPITA: [
    'file:upload', 'lot:lookup', 'drying:read',
    'raking:read-own-group', 'raking:record-own-group', 'defect:read-own-group', 'defect:record-own-group',
    'worker:read-own-group', 'attendance:read-own-group', 'attendance:record-own-group',
    'payroll:read-own-group', 'siv:request-own-group',
  ],
  TEMP_WORKER: ['worker:read-self', 'attendance:read-self', 'payroll:read-self'],
  AUDITOR: [...READ_EVERYTHING, 'file:upload', 'audit:manage', 'ca:create', 'ca:verify', 'report:export'],
};

export function permissionModule(code: string): string {
  return code.split(':')[0]!;
}
export function permissionAction(code: string): string {
  return code.split(':').slice(1).join(':');
}
