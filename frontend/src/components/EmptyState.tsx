import InboxOutlined from '@mui/icons-material/InboxOutlined';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

export interface EmptyStateProps {
  title: string;
  message?: ReactNode;
  /** Defaults to an empty-tray icon. */
  icon?: ReactNode;
  /** e.g. { label: 'Create voucher', to: '/purchases/new' } */
  action?: { label: string; to?: string; onClick?: () => void };
  /** Less padding, for use inside tables and cards. */
  compact?: boolean;
}

/** "Nothing here yet" message with an optional next step (spec §4). */
export function EmptyState({ title, message, icon, action, compact }: EmptyStateProps) {
  return (
    <Stack spacing={1} role="status" sx={{ alignItems: 'center', textAlign: 'center', py: compact ? 3 : 6, px: 2 }}>
      <Box
        aria-hidden
        sx={{
          width: compact ? 48 : 64, height: compact ? 48 : 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
          bgcolor: 'action.hover', color: 'primary.main', mb: 1, '& svg': { fontSize: compact ? 26 : 34 },
        }}
      >
        {icon ?? <InboxOutlined />}
      </Box>
      <Typography variant="subtitle1" component="p">{title}</Typography>
      {message && <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>{message}</Typography>}
      {action && (action.to
        ? <Button variant="contained" component={RouterLink} to={action.to} sx={{ mt: 1 }}>{action.label}</Button>
        : <Button variant="contained" onClick={action.onClick} sx={{ mt: 1 }}>{action.label}</Button>)}
    </Stack>
  );
}
