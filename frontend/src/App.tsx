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

// Administration pages are split into their own chunks.
const UsersPage = lazy(() => import('./pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('./pages/admin/RolesPage').then((m) => ({ default: m.RolesPage })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AuditLogPage = lazy(() => import('./pages/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));

const PHASE1_PAGES: Record<string, React.ReactElement> = {
  '/': <DashboardPage />,
  '/admin/users': <UsersPage />,
  '/admin/roles': <RolesPage />,
  '/admin/settings': <SettingsPage />,
  '/admin/audit-log': <AuditLogPage />,
};

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
      {NAV_ITEMS.map((item) => (
        <Route key={item.path} path={item.path} element={
          <RequireAuth>
            <AppShell>
              <RequirePermission permission={item.permission}>
                <Suspense fallback={<Loading />}>
                  {PHASE1_PAGES[item.path] ?? <ComingSoonPage label={item.label} phase={item.phase} />}
                </Suspense>
              </RequirePermission>
            </AppShell>
          </RequireAuth>
        } />
      ))}
      <Route path="*" element={<RequireAuth><AppShell><NotFoundPage /></AppShell></RequireAuth>} />
    </Routes>
  );
}
