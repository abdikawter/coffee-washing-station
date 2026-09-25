import { Alert, Box, Chip, CircularProgress, Stack, Typography, type ChipProps } from '@mui/material';
import type { ReactNode } from 'react';
import { errorMessage } from '../api/client';

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

const STATUS_COLORS: Record<string, ChipProps['color']> = {
  ACTIVE: 'success', CONFIRMED: 'success', MANUAL: 'info', PROVISIONAL: 'warning', UNSET: 'error',
  INACTIVE: 'default', LOCKED: 'error',
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return <Chip size="small" label={label ?? status} color={STATUS_COLORS[status] ?? 'default'} variant={status === 'INACTIVE' ? 'outlined' : 'filled'} />;
}
