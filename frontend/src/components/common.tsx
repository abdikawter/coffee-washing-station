import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { errorMessage } from '../api/client';

// Moved to their own files in Phase 3B step 3; re-exported so existing imports keep working.
export { PageHeader } from './PageHeader';
export { StatusChip } from './StatusChip';

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(error)}</Alert>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ p: 4, justifyContent: 'center', alignItems: 'center' }} role="status">
      <CircularProgress size={24} />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  );
}

/** Label + value pair used on detail screens. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">{label}</Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word' }}>{children ?? '—'}</Typography>
    </Box>
  );
}
