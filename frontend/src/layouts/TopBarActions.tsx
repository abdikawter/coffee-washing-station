import CheckIcon from '@mui/icons-material/Check';
import ContrastIcon from '@mui/icons-material/Contrast';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import KeyIcon from '@mui/icons-material/Key';
import LightModeIcon from '@mui/icons-material/LightMode';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import {
  Avatar, Box, Divider, IconButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useColorMode, type ColorMode } from '../theme';
import { humanize } from '../utils/format';

/** Notifications arrive in Phase 7; the bell is shown now so the layout does not move later. */
export function NotificationsButton() {
  return (
    <Tooltip title="Notifications (coming in phase 7)">
      <span>
        <IconButton color="inherit" disabled aria-label="Notifications" sx={{ '&.Mui-disabled': { color: 'inherit', opacity: 0.5 } }}>
          <NotificationsNoneIcon />
        </IconButton>
      </span>
    </Tooltip>
  );
}

export type Language = 'en' | 'am';
const LANG_KEY = 'cws.language';
const readLanguage = (): Language => { try { return localStorage.getItem(LANG_KEY) === 'am' ? 'am' : 'en'; } catch { return 'en'; } };

/**
 * EN / አማ switch (spec §6). The choice is remembered and sets `<html lang>`;
 * Amharic labels are added later, so the text stays English for now.
 */
export function LanguageSwitch() {
  const [lang, setLang] = useState<Language>(readLanguage);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const change = (l: Language | null) => {
    if (!l) return;
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* keep in memory */ }
  };
  return (
    <ToggleButtonGroup exclusive size="small" value={lang} onChange={(_, l: Language | null) => change(l)} aria-label="Language"
      sx={{
        mx: 0.5, '& .MuiToggleButton-root': { color: 'inherit', borderColor: 'currentColor', px: 1, py: 0.25, minWidth: 40, lineHeight: 1.4, opacity: 0.8 },
        '& .MuiToggleButton-root.Mui-selected': { color: 'inherit', bgcolor: 'action.selected', opacity: 1, fontWeight: 700 },
      }}>
      <ToggleButton value="en" aria-label="English">EN</ToggleButton>
      <ToggleButton value="am" aria-label="Amharic" lang="am">አማ</ToggleButton>
    </ToggleButtonGroup>
  );
}

const MODES: { mode: ColorMode; label: string; icon: ReactNode }[] = [
  { mode: 'light', label: 'Light', icon: <LightModeIcon fontSize="small" /> },
  { mode: 'dark', label: 'Dark', icon: <DarkModeIcon fontSize="small" /> },
  { mode: 'contrast', label: 'High contrast (outdoor)', icon: <ContrastIcon fontSize="small" /> },
];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

/** Avatar menu: who is signed in, theme (light / dark / high contrast), change password, sign out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { mode, setMode } = useColorMode();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  if (!user) return null;
  return (
    <>
      <Tooltip title="Account and theme">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Open user menu" aria-haspopup="menu" sx={{ p: 0.5, ml: 0.5 }}>
          <Avatar sx={{ width: 34, height: 34, bgcolor: 'secondary.main', color: 'secondary.contrastText', typography: 'subtitle2' }}>{initials(user.fullName)}</Avatar>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2">{user.fullName}</Typography>
          <Typography variant="caption" color="text.secondary" component="div">{user.username}</Typography>
          {user.roles.length > 0 && <Typography variant="caption" color="text.secondary" component="div">{user.roles.map(humanize).join(', ')}</Typography>}
        </Box>
        <Divider />
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>Theme</ListSubheader>
        {MODES.map((m) => (
          <MenuItem key={m.mode} selected={m.mode === mode} onClick={() => setMode(m.mode)} aria-checked={m.mode === mode} role="menuitemradio">
            <ListItemIcon>{m.icon}</ListItemIcon>
            <ListItemText>{m.label}</ListItemText>
            {m.mode === mode && <CheckIcon fontSize="small" color="primary" />}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => { close(); navigate('/change-password'); }}>
          <ListItemIcon><KeyIcon fontSize="small" /></ListItemIcon>Change password
        </MenuItem>
        <MenuItem onClick={async () => { close(); await logout(); navigate('/login'); }}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>Sign out
        </MenuItem>
      </Menu>
    </>
  );
}
