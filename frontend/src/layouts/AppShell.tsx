import LocalCafeOutlined from '@mui/icons-material/LocalCafeOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import { AppBar, Box, Drawer, IconButton, Link, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { visibleNav } from '../navigation';
import { GlobalSearch } from './GlobalSearch';
import { SettingsBar } from './SettingsBar';
import { NAV_WIDTH, NAV_WIDTH_COLLAPSED, SideNav } from './SideNav';
import { LanguageSwitch, NotificationsButton, UserMenu } from './TopBarActions';

const COLLAPSE_KEY = 'cws.nav.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };

/**
 * App shell (spec §6): top bar (menu, name, global search, notifications, language,
 * user menu with theme), left navigation grouped by section — collapsible to icons
 * on desktop, a drawer on phones — and the slim "settings to confirm" bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const items = visibleNav(user);
  const navWidth = collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH;

  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* remember for this visit only */ }
    return !c;
  });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Link href="#main" sx={{
        position: 'absolute', left: 8, top: -48, zIndex: (t) => t.zIndex.tooltip, px: 2, py: 1, bgcolor: 'background.paper', borderRadius: 1,
        '&:focus': { top: 8 },
      }}>
        Skip to content
      </Link>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: { xs: 0.5, sm: 1 } }}>
          {!desktop && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <MenuIcon />
            </IconButton>
          )}
          <Box component={RouterLink} to="/" aria-label="Coffee Washing Station — home"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'inherit', textDecoration: 'none', mr: { md: 2 }, minWidth: 0 }}>
            <LocalCafeOutlined aria-hidden />
            <Typography variant="h6" component="span" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>Coffee Washing Station</Typography>
            <Typography variant="h6" component="span" sx={{ display: { xs: 'block', sm: 'none' } }}>CWS</Typography>
          </Box>
          <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: { xs: 'flex-end', md: 'flex-start' } }}>
            <GlobalSearch compact={!desktop} />
          </Box>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}><NotificationsButton /></Box>
          <LanguageSwitch />
          <UserMenu />
        </Toolbar>
      </AppBar>
      {desktop ? (
        <Drawer variant="permanent" open
          sx={{
            width: navWidth, flexShrink: 0, transition: (t) => t.transitions.create('width'),
            '& .MuiDrawer-paper': { width: navWidth, boxSizing: 'border-box', overflowX: 'hidden', transition: (t) => t.transitions.create('width') },
          }}>
          <SideNav items={items} collapsed={collapsed} onToggle={toggleCollapsed} />
        </Drawer>
      ) : (
        <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: Math.min(NAV_WIDTH + 16, 320), boxSizing: 'border-box' } }}>
          <SideNav items={items} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      )}
      <Box component="main" id="main" tabIndex={-1} sx={{ flexGrow: 1, minWidth: 0, outline: 'none' }}>
        <Toolbar />
        <SettingsBar />
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
