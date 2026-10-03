import { Alert, Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { errorMessage } from '../api/client';
import { statusTone, toneColor, type StatusDomain } from '../theme';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
      <Box>
        <Typography variant="h5" component="h1">{title}</Typography>
        {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1}>{actions}</Stack>}
    </Stack>
  );
}

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

/** Status colours come from theme/status.ts (fixed meaning everywhere — spec §2.1). Restyled in Phase 3B step 2. */
export function StatusChip({ status, label, domain }: { status: string; label?: string; domain?: StatusDomain }) {
  const tone = statusTone(status, domain);
  return <Chip size="small" label={label ?? status} color={toneColor(tone)} variant={tone === 'neutral' ? 'outlined' : 'filled'} />;
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
