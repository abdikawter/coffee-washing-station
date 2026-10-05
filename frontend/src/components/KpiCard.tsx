import { Box, Card, CardActionArea, CardContent, Skeleton, Stack, Typography, useTheme } from '@mui/material';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { formatNumber } from '../utils/decimal';

export interface KpiChange {
  /** Signed decimal string, e.g. "12.5" or "-3" (percent vs the previous period). */
  value: string;
  /** e.g. "vs yesterday". */
  label?: string;
  /** Which direction is good news — sets the colour. Default 'up'. */
  goodWhen?: 'up' | 'down';
}

export interface KpiCardProps {
  label: string;
  /** Decimal string or integer count. */
  value: string | number | null | undefined;
  unit?: string;
  /** Decimal places for a string value (default 0). */
  dp?: number;
  change?: KpiChange;
  /** Small trend line (oldest → newest). */
  sparkline?: number[];
  /** Extra line under the number. */
  hint?: ReactNode;
  /** Click-through to the detail list. */
  to?: string;
  loading?: boolean;
}

function ChangeLine({ value, label, goodWhen = 'up' }: KpiChange) {
  const n = value.trim();
  const zero = /^-?0*(\.0*)?$/.test(n);
  const down = n.startsWith('-');
  const good = zero ? null : (down ? goodWhen === 'down' : goodWhen === 'up');
  const color = good === null ? 'text.secondary' : good ? 'success.main' : 'error.main';
  const arrow = zero ? '–' : down ? '▼' : '▲';
  return (
    <Typography variant="body2" sx={{ color, fontWeight: 600 }} data-testid="kpi-change">
      <span aria-hidden>{arrow}</span> {formatNumber(n.replace(/^[-+]/, ''), 1)} %
      {label && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}> {label}</Box>}
      <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {zero ? ' (no change)' : down ? ' (down)' : ' (up)'}
      </Box>
    </Typography>
  );
}

/** Dashboard figure: label, big number + unit, change vs previous period, optional sparkline (spec §4). */
export function KpiCard({ label, value, unit, dp = 0, change, sparkline, hint, to, loading }: KpiCardProps) {
  const theme = useTheme();
  const shown = typeof value === 'number' ? formatNumber(String(value), 0) : formatNumber(value, dp);
  const body = (
    <CardContent sx={{ '&:last-child': { pb: 2 } }}>
      <Typography variant="subtitle2" color="text.secondary" component="h3">{label}</Typography>
      {loading ? <Skeleton variant="text" sx={{ typography: 'kpi', width: '60%' }} /> : (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 0.5 }}>
          <Typography variant="kpi" component="p">{shown}</Typography>
          {unit && value !== null && value !== undefined && <Typography variant="subtitle1" color="text.secondary">{unit}</Typography>}
        </Stack>
      )}
      {!loading && change && <ChangeLine {...change} />}
      {!loading && hint && <Typography variant="body2" color="text.secondary">{hint}</Typography>}
      {!loading && sparkline && sparkline.length > 1 && (
        <Box sx={{ mt: 1 }} aria-hidden>
          <SparkLineChart data={sparkline} height={36} color={theme.vars?.palette.secondary.main ?? theme.palette.secondary.main} />
        </Box>
      )}
    </CardContent>
  );
  return (
    <Card sx={{ height: '100%' }}>
      {to ? <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>{body}</CardActionArea> : body}
    </Card>
  );
}
