import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import {
  Alert, AppBar, Box, Button, Chip, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  ListSubheader, Toolbar, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { settingsApi } from '../api/endpoints';
import { useAuth } from '../auth/useAuth';
import { DELIVERED_PHASE, visibleNav, type NavItem } from '../navigation';
import { humanize } from '../utils/format';

const DRAWER_WIDTH = 264;

/** Banner shown until every PROVISIONAL/UNSET setting is confirmed (ARCHITECTURE.md §20). */
function UnconfirmedSettingsBanner() {
  const { can } = useAuth();
  const enabled = can('settings:read');
  const { data } = useQuery({ queryKey: ['settings', 'unconfirmed'], queryFn: settingsApi.unconfirmed, enabled, staleTime: 60_000 });
  if (!enabled || !data?.length) return null;
  return (
    <Alert severity="warning" sx={{ borderRadius: 0 }}
      action={can(['settings:manage', 'settings:manage-system']) ? <Button component={RouterLink} to="/admin/settings?filter=unconfirmed" color="inherit" size="small">Review</Button> : undefined}>
      {data.length} setting{data.length === 1 ? '' : 's'} still need confirmation by the site manager (provisional or not yet set).
    </Alert>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const items = visibleNav(user);
  const sections = [...new Set(items.map((i) => i.section))];

  const isActive = (i: NavItem) => (i.path === '/' ? location.pathname === '/' : location.pathname.startsWith(i.path));

  const drawer = (
    <Box sx={{ overflowY: 'auto' }}>
      <Toolbar />
      <List dense>
        {sections.map((section) => (
          <Fragment key={section}>
            <ListSubheader sx={{ bgcolor: 'transparent', lineHeight: '32px', mt: 1 }}>{section}</ListSubheader>
            {items.filter((i) => i.section === section).map((i) => (
              <ListItemButton key={i.path} component={RouterLink} to={i.path} selected={isActive(i)} onClick={() => setOpen(false)} sx={{ mx: 1, borderRadius: 2 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>{i.icon}</ListItemIcon>
                <ListItemText primary={i.label} />
                {i.phase > DELIVERED_PHASE && <Chip size="small" label={`P${i.phase}`} variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
              </ListItemButton>
            ))}
          </Fragment>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          {!desktop && (
            <IconButton color="inherit" edge="start" onClick={() => setOpen(true)} aria-label="Open navigation" sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>Coffee Washing Station</Typography>
          <Box sx={{ textAlign: 'right', mr: 1, display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>{user?.fullName}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>{user?.roles.map(humanize).join(', ')}</Typography>
          </Box>
          <Tooltip title="Sign out">
            <IconButton color="inherit" aria-label="Sign out" onClick={async () => { await logout(); navigate('/login'); }}>
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Drawer
        variant={desktop ? 'permanent' : 'temporary'}
        open={desktop || open}
        onClose={() => setOpen(false)}
        sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
      >
        {drawer}
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        <UnconfirmedSettingsBanner />
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
