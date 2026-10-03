import { Card, CardActionArea, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { lotsApi } from '../api/processing';
import { paymentsApi, purchasesApi, scalesApi } from '../api/procurement';
import { useAuth } from '../auth/useAuth';
import { PageHeader } from '../components/common';
import { DELIVERED_PHASE, visibleNav } from '../navigation';
import { formatNumber } from '../utils/decimal';

function Kpi({ label, value, hint, to, alert }: { label: string; value: ReactNode; hint?: string; to: string; alert?: boolean }) {
  return (
    <Grid size={{ xs: 6, md: 3 }}>
      <Card variant="outlined" sx={{ height: '100%', borderColor: alert ? 'warning.main' : undefined }}>
        <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>{value}</Typography>
            {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
          </CardContent>
        </CardActionArea>
      </Card>
    </Grid>
  );
}

/** Procurement KPI cards (Phase 2); later phases add their own cards. */
function ProcurementKpis() {
  const { can } = useAuth();
  const purchases = useQuery({ queryKey: ['purchases', 'summary'], queryFn: purchasesApi.summary, enabled: can('purchase:read'), refetchInterval: 60_000 });
  const toApprove = useQuery({ queryKey: ['payments', 'count', 'PENDING_APPROVAL'], queryFn: () => paymentsApi.list({ page: 1, pageSize: 1, status: 'PENDING_APPROVAL' }), enabled: can('payment:read') });
  const toPay = useQuery({ queryKey: ['payments', 'count', 'APPROVED'], queryFn: () => paymentsApi.list({ page: 1, pageSize: 1, status: 'APPROVED' }), enabled: can('payment:read') });
  const scales = useQuery({ queryKey: ['scales'], queryFn: scalesApi.list, enabled: can('scale:read') });
  const board = useQuery({ queryKey: ['lots', 'board'], queryFn: lotsApi.board, enabled: can('lot:read'), refetchInterval: 60_000 });
  const inProcess = board.data?.filter((c) => c.stage !== 'PURCHASED' && c.stage !== 'GRADING').reduce((n, c) => n + c.lots.length, 0);
  const waiting = board.data?.find((c) => c.stage === 'PURCHASED')?.lots.length;
  const s = purchases.data;
  const unverified = scales.data?.filter((x) => !x.verification.verified).length;
  if (!s && toApprove.data === undefined && unverified === undefined && inProcess === undefined) return null;
  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      {s && <Kpi label="Cherry bought today" value={`${formatNumber(s.todayKg, 0)} kg`} hint={`${s.todayVouchers} vouchers · ${formatNumber(s.todayAmount)}`} to="/purchases" />}
      {s && <Kpi label="Vouchers to verify / approve" value={`${s.pendingVerification} / ${s.verified}`} to="/purchases" alert={s.pendingVerification + s.verified > 0} />}
      {toApprove.data && toPay.data && (
        <Kpi label="Payments to approve / pay out" value={`${toApprove.data.meta.total} / ${toPay.data.meta.total}`} to="/payments" alert={toApprove.data.meta.total + toPay.data.meta.total > 0} />
      )}
      {unverified !== undefined && <Kpi label="Scales not verified" value={unverified} hint={`of ${scales.data?.length ?? 0}`} to="/scales" alert={unverified > 0} />}
      {inProcess !== undefined && <Kpi label="Lots in wet processing" value={inProcess} hint={`${waiting ?? 0} waiting for the hopper`} to="/processing" />}
    </Grid>
  );
}

/** Dashboard: KPI cards for the delivered modules + the user's module shortcuts. */
export function DashboardPage() {
  const { user } = useAuth();
  const modules = visibleNav(user).filter((i) => i.path !== '/');
  return (
    <>
      <PageHeader title={`Welcome, ${user?.fullName.split(' ')[0] ?? ''}`} subtitle="Your modules, based on your role." />
      <ProcurementKpis />
      <Grid container spacing={2}>
        {modules.map((m) => (
          <Grid key={m.path} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardActionArea component={RouterLink} to={m.path} sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    {m.icon}
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>{m.label}</Typography>
                    <Chip size="small" label={m.phase <= DELIVERED_PHASE ? 'Available' : `Phase ${m.phase}`} color={m.phase <= DELIVERED_PHASE ? 'success' : 'default'} variant="outlined" />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );
}
