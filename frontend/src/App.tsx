import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loading } from './components/common';
import { AppShell } from './layouts/AppShell';
import { NAV_ITEMS } from './navigation';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { ComingSoonPage, NotFoundPage } from './pages/ErrorPages';
import { LoginPage } from './pages/LoginPage';
import { RequireAuth, RequirePermission } from './routes/guards';

// Feature pages are split into their own chunks.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const UsersPage = page(() => import('./pages/admin/UsersPage'), 'UsersPage');
const RolesPage = page(() => import('./pages/admin/RolesPage'), 'RolesPage');
const SettingsPage = page(() => import('./pages/admin/SettingsPage'), 'SettingsPage');
const AuditLogPage = page(() => import('./pages/admin/AuditLogPage'), 'AuditLogPage');
const SuppliersPage = page(() => import('./pages/procurement/SuppliersPage'), 'SuppliersPage');
const SupplierProfilePage = page(() => import('./pages/procurement/SupplierProfilePage'), 'SupplierProfilePage');
const InspectionFormPage = page(() => import('./pages/procurement/InspectionFormPage'), 'InspectionFormPage');
const QualityPage = page(() => import('./pages/procurement/QualityPage'), 'QualityPage');
const ScalesPage = page(() => import('./pages/procurement/ScalesPage'), 'ScalesPage');
const EquipmentDetailPage = page(() => import('./pages/procurement/EquipmentPage'), 'EquipmentDetailPage');
const EquipmentPage = page(() => import('./pages/procurement/EquipmentPage'), 'EquipmentPage');
const PurchasesPage = page(() => import('./pages/procurement/PurchasesPage'), 'PurchasesPage');
const NewVoucherPage = page(() => import('./pages/procurement/NewVoucherPage'), 'NewVoucherPage');
const VoucherDetailPage = page(() => import('./pages/procurement/VoucherDetailPage'), 'VoucherDetailPage');
const PaymentsPage = page(() => import('./pages/procurement/PaymentsPage'), 'PaymentsPage');
const LotsPage = page(() => import('./pages/processing/LotsPage'), 'LotsPage');
const LotDetailPage = page(() => import('./pages/processing/LotDetailPage'), 'LotDetailPage');
const ProcessingPage = page(() => import('./pages/processing/ProcessingPage'), 'ProcessingPage');

/** Pages delivered so far, keyed by navigation path; other nav items show "coming in phase N". */
const PAGES: Record<string, React.ReactElement> = {
  '/': <DashboardPage />,
  '/suppliers': <SuppliersPage />,
  '/quality': <QualityPage />,
  '/scales': <ScalesPage />,
  '/equipment': <EquipmentPage />,
  '/purchases': <PurchasesPage />,
  '/payments': <PaymentsPage />,
  '/lots': <LotsPage />,
  '/processing': <ProcessingPage />,
  '/admin/users': <UsersPage />,
  '/admin/roles': <RolesPage />,
  '/admin/settings': <SettingsPage />,
  '/admin/audit-log': <AuditLogPage />,
};

/** Routes that are not navigation items (detail and creation screens). */
const EXTRA_ROUTES: { path: string; permission: string[]; element: React.ReactElement }[] = [
  { path: '/suppliers/:id', permission: ['supplier:read'], element: <SupplierProfilePage /> },
  { path: '/quality/inspections/new', permission: ['quality:inspect'], element: <InspectionFormPage /> },
  { path: '/equipment/:id', permission: ['equipment:read'], element: <EquipmentDetailPage /> },
  { path: '/purchases/new', permission: ['purchase:create'], element: <NewVoucherPage /> },
  { path: '/purchases/:id', permission: ['purchase:read'], element: <VoucherDetailPage /> },
  { path: '/lots/:id', permission: ['lot:read', 'lot:lookup'], element: <LotDetailPage /> },
];

function Protected({ permission, children }: { permission?: string[]; children: React.ReactElement }) {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission permission={permission}>
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
      {NAV_ITEMS.map((item) => (
        <Route key={item.path} path={item.path} element={
          <Protected permission={item.permission}>{PAGES[item.path] ?? <ComingSoonPage label={item.label} phase={item.phase} />}</Protected>
        } />
      ))}
      {EXTRA_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<Protected permission={r.permission}>{r.element}</Protected>} />)}
      <Route path="*" element={<RequireAuth><AppShell><NotFoundPage /></AppShell></RequireAuth>} />
    </Routes>
  );
}
