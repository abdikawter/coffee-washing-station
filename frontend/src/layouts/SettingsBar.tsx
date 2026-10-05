import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { settingsApi } from '../api/endpoints';
import { useAuth } from '../auth/useAuth';

const KEY = 'cws.settingsBar.dismissed';
const readDismissed = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };

/**
 * Slim, dismissible bar shown until every PROVISIONAL / UNSET setting is
 * confirmed (ARCHITECTURE.md §20, spec §6). Dismissing hides it for this browser
 * session; it comes back if the number of settings to confirm changes.
 */
export function SettingsBar() {
  const { can } = useAuth();
  const enabled = can('settings:read');
  const { data } = useQuery({ queryKey: ['settings', 'unconfirmed'], queryFn: settingsApi.unconfirmed, enabled, staleTime: 60_000 });
  const [dismissed, setDismissed] = useState(readDismissed);
  const count = data?.length ?? 0;
  if (!enabled || !count || dismissed === String(count)) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(KEY, String(count)); } catch { /* private window: hide until reload */ }
    setDismissed(String(count));
  };
  return (
    <Box role="status" sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: { xs: 2, md: 3 }, py: 0.5, minHeight: 40,
      bgcolor: 'warning.main', color: 'warning.contrastText',
    }}>
      <WarningAmberIcon fontSize="small" aria-hidden />
      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
        {count} setting{count === 1 ? '' : 's'} still need confirmation by the site manager.
      </Typography>
      {can(['settings:manage', 'settings:manage-system']) && (
        <Button component={RouterLink} to="/admin/settings?filter=unconfirmed" color="inherit" size="small" sx={{ minHeight: 32, textDecoration: 'underline' }}>Review</Button>
      )}
      <IconButton size="small" color="inherit" onClick={dismiss} aria-label="Dismiss">
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
