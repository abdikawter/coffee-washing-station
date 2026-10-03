import {
  Alert, Box, Button, Card, CardContent, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { lotsApi } from '../../api/processing';
import { Can } from '../../auth/Can';
import { ErrorAlert, Field, Loading, PageHeader, StatusChip } from '../../components/common';
import { formatNumber } from '../../utils/decimal';
import { formatDateTime, humanize } from '../../utils/format';

/** Lot page: identity, parent / grade lots, weight progression (outturn) and the event timeline. */
export function LotDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const lot = useQuery({ queryKey: ['lots', id], queryFn: () => lotsApi.get(id) });
  const events = useQuery({ queryKey: ['lots', id, 'events'], queryFn: () => lotsApi.events(id) });
  const outturn = useQuery({ queryKey: ['lots', id, 'outturn'], queryFn: () => lotsApi.outturn(id) });

  if (lot.isLoading) return <Loading />;
  if (!lot.data) return <ErrorAlert error={lot.error} />;
  const l = lot.data;

  return (
    <>
      <PageHeader title={`Lot ${l.lotNumber}`} subtitle={`${l.supplierName ?? ''}${l.voucherNo ? ` · voucher ${l.voucherNo}` : ''}`}
        actions={<Button onClick={() => navigate(-1)}>Back</Button>} />
      <ErrorAlert error={events.error ?? outturn.error} />
      {l.activeHold && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" component={RouterLink} to="/quality?tab=holds">Holds</Button>}>
          On quality hold{l.activeHold.lotId !== l.id ? ' (through its parent lot)' : ''}: {l.activeHold.reason}. Every processing step is blocked.
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <StatusChip status={l.status} label={humanize(l.status)} />
            <StatusChip status="VERIFIED" label={humanize(l.currentStage)} />
            {l.type === 'GRADE_SPLIT' && <StatusChip status="APPROVED" label={`Grade ${l.gradeCode}`} />}
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
            <Field label="Current weight">{formatNumber(l.currentWeightKg, 3)} kg</Field>
            <Field label="Original cherry (root lot)">{formatNumber(l.originalCherryWeightKg, 3)} kg</Field>
            <Field label="Processing date">{l.processingDate}</Field>
            <Field label="Location">{l.currentLocation}</Field>
            <Field label="Type">{humanize(l.type)}</Field>
            <Field label="From lot">{l.parentLotId ? <RouterLink to={`/lots/${l.parentLotId}`}>{l.parentLotNumber}</RouterLink> : null}</Field>
            <Field label="Purchase voucher">
              {l.purchaseVoucherId ? <Can permission="purchase:read" fallback={l.voucherNo}><RouterLink to={`/purchases/${l.purchaseVoucherId}`}>{l.voucherNo}</RouterLink></Can> : null}
            </Field>
          </Box>
          {l.children.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Grade lots</Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {l.children.map((c) => (
                  <Button key={c.id} variant="outlined" size="small" component={RouterLink} to={`/lots/${c.id}`}>
                    {c.lotNumber} · {formatNumber(c.currentWeightKg, 3)} kg · {humanize(c.currentStage)}
                  </Button>
                ))}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Outturn so far</Typography>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={1.5}>
            {outturn.data?.steps.map((s) => (
              <Box key={s.key}>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2">{s.label}</Typography>
                  <Typography variant="body2" color={s.weightKg ? undefined : 'text.secondary'}>
                    {s.weightKg ? `${formatNumber(s.weightKg, 3)} kg · ${s.outturnPct} %` : 'not yet'}
                  </Typography>
                </Stack>
                <LinearProgress variant="determinate" value={s.outturnPct ? Math.min(Number(s.outturnPct), 100) : 0} sx={{ height: 6, borderRadius: 3 }} />
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Timeline</Typography>
      <Card variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>When</TableCell><TableCell>Event</TableCell><TableCell>Lot</TableCell><TableCell align="right">kg</TableCell><TableCell>Where</TableCell><TableCell>By</TableCell></TableRow>
          </TableHead>
          <TableBody>
            {events.data?.map((e) => (
              <TableRow key={e.id} sx={e.lotId !== l.id ? { '& td': { color: 'text.secondary' } } : undefined}>
                <TableCell>{formatDateTime(e.occurredAt)}</TableCell>
                <TableCell>{humanize(e.eventType)}</TableCell>
                <TableCell>{e.lotNumber}</TableCell>
                <TableCell align="right">{e.quantityKg ? formatNumber(e.quantityKg, 3) : '—'}</TableCell>
                <TableCell>{e.location ?? '—'}</TableCell>
                <TableCell>{e.userName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
