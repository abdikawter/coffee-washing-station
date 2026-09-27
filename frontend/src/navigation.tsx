import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BadgeIcon from '@mui/icons-material/Badge';
import BuildIcon from '@mui/icons-material/Build';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import GroupsIcon from '@mui/icons-material/Groups';
import HistoryIcon from '@mui/icons-material/History';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import PaymentsIcon from '@mui/icons-material/Payments';
import PeopleIcon from '@mui/icons-material/People';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ScaleIcon from '@mui/icons-material/Scale';
import SettingsIcon from '@mui/icons-material/Settings';
import VerifiedIcon from '@mui/icons-material/Verified';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { ReactElement } from 'react';
import type { Principal } from './api/types';
import { hasPermission } from './auth/AuthContext';

/** Highest roadmap phase already delivered (ARCHITECTURE.md §17); later items show a "coming" badge. */
export const DELIVERED_PHASE = 2;

export interface NavItem {
  label: string;
  path: string;
  icon: ReactElement;
  /** any-of; undefined = every signed-in user */
  permission?: string[];
  /** roadmap phase that delivers the page (ARCHITECTURE.md §17) */
  phase: number;
  section: 'Operations' | 'Warehouse & people' | 'Control' | 'Administration';
}

/** One entry per navigation item of the design; shown only to users who may use it. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: <DashboardIcon />, phase: 1, section: 'Operations' },
  { label: 'Suppliers', path: '/suppliers', icon: <AgricultureIcon />, permission: ['supplier:read'], phase: 2, section: 'Operations' },
  { label: 'Quality', path: '/quality', icon: <VerifiedIcon />, permission: ['quality:read', 'quality:hold-read'], phase: 2, section: 'Operations' },
  { label: 'Scales', path: '/scales', icon: <ScaleIcon />, permission: ['scale:read'], phase: 2, section: 'Operations' },
  { label: 'Purchasing', path: '/purchases', icon: <ReceiptLongIcon />, permission: ['purchase:read'], phase: 2, section: 'Operations' },
  { label: 'Payments', path: '/payments', icon: <PaymentsIcon />, permission: ['payment:read'], phase: 2, section: 'Operations' },
  { label: 'Lots & traceability', path: '/lots', icon: <AccountTreeIcon />, permission: ['lot:read', 'lot:lookup'], phase: 3, section: 'Operations' },
  { label: 'Wet processing', path: '/processing', icon: <WaterDropIcon />, permission: ['hopper:read', 'pulping:read', 'fermentation:read', 'washing:read'], phase: 3, section: 'Operations' },
  { label: 'Equipment', path: '/equipment', icon: <BuildIcon />, permission: ['equipment:read'], phase: 2, section: 'Operations' },
  { label: 'Drying', path: '/drying', icon: <WbSunnyIcon />, permission: ['drying:read'], phase: 4, section: 'Operations' },
  { label: 'Warehouse', path: '/warehouse', icon: <Inventory2Icon />, permission: ['warehouse:read', 'srv:read', 'inventory:read'], phase: 5, section: 'Warehouse & people' },
  { label: 'Workers & payroll', path: '/workforce', icon: <GroupsIcon />, permission: ['worker:read', 'worker:read-own-group', 'worker:read-self'], phase: 6, section: 'Warehouse & people' },
  { label: 'Rations & issues', path: '/rations', icon: <LocalShippingIcon />, permission: ['siv:read', 'siv:request', 'siv:request-own-group'], phase: 6, section: 'Warehouse & people' },
  { label: 'Finance', path: '/finance', icon: <PaymentsIcon />, permission: ['expense:read', 'cash:read'], phase: 7, section: 'Control' },
  { label: 'Audits', path: '/audits', icon: <FactCheckIcon />, permission: ['audit:read'], phase: 7, section: 'Control' },
  { label: 'Corrective actions', path: '/corrective-actions', icon: <WarningAmberIcon />, permission: ['ca:read', 'ca:read-assigned'], phase: 7, section: 'Control' },
  { label: 'Reports', path: '/reports', icon: <AssessmentIcon />, permission: ['report:procurement', 'report:quality', 'report:production', 'report:drying', 'report:warehouse', 'report:workforce', 'report:finance'], phase: 8, section: 'Control' },
  { label: 'Users', path: '/admin/users', icon: <PeopleIcon />, permission: ['user:read'], phase: 1, section: 'Administration' },
  { label: 'Roles', path: '/admin/roles', icon: <BadgeIcon />, permission: ['role:read'], phase: 1, section: 'Administration' },
  { label: 'Settings', path: '/admin/settings', icon: <SettingsIcon />, permission: ['settings:read'], phase: 1, section: 'Administration' },
  { label: 'Audit log', path: '/admin/audit-log', icon: <HistoryIcon />, permission: ['auditlog:read'], phase: 1, section: 'Administration' },
];

export function visibleNav(user: Principal | null): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.permission || hasPermission(user, i.permission));
}
