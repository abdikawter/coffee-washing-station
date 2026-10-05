import { Alert, Box, Button, LinearProgress, Link, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { LOT_STAGES, lotsApi, type LotEvent } from '../../api/processing';
import { Can } from '../../auth/Can';
import { ErrorAlert, Field, JourneyStepper, SectionCard, StatusChip, WeightText, type JourneyStage, type TimelineItem } from '../../components';
import { DetailTemplate } from '../../templates';
import { formatNumber } from '../../utils/decimal';
import { humanize } from '../../utils/format';

/** Weight and date reached per stage, from the lot's events (latest weight, first time at the stage). */
export function journeyFromEvents(events: LotEvent[]): JourneyStage[] {
  return LOT_STAGES.map((code) => {
    const at = events.filter((e) => e.stage === code).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const withKg = at.filter((e) => e.quantityKg);
    return { code, date: at[0]?.occurredAt ?? null, weightKg: withKg[withKg.length - 1]?.quantityKg ?? null };
  });
}

/** Lot page (spec §7): journey stepper with weights per stage, outturn so far, grade lots and the event timeline. */
export function LotDetailPage() {
  const { id = '' } = useParams();
  const lot = useQuery({ queryKey: ['lots', id], queryFn: () => lotsApi.get(id) });
  const events = useQuery({ queryKey: ['lots', id, 'events'], queryFn: () => lotsApi.events(id) });
  const outturn = useQuery({ queryKey: ['lots', id, 'outturn'], queryFn: () => lotsApi.outturn(id) });
  const l = lot.data;

  const timeline: TimelineItem[] = [...(events.data ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((e) => ({
    id: e.id,
    title: `${humanize(e.eventType)}${e.lotId !== id ? ` · ${e.lotNumber}` : ''}`,
    at: e.occurredAt,
    by: e.userName,
    tone: e.eventType.includes('HOLD') ? 'error' : e.lotId !== id ? 'neutral' : 'info',
    description: [e.quantityKg ? `${formatNumber(e.quantityKg, 3)} kg` : null, e.location].filter(Boolean).join(' · ') || undefined,
  }));

  return (
    <DetailTemplate
      title={l ? `Lot ${l.lotNumber}` : 'Lot'}
      subtitle={l && [l.supplierName, l.voucherNo && `voucher ${l.voucherNo}`].filter(Boolean).join(' · ')}
      breadcrumbs={[{ label: 'Lots', to: '/lots' }, { label: l?.lotNumber ?? '…' }]}
      status={l && <Stack direction="row" spacing={1}>
        <StatusChip status={l.activeHold ? 'ON_HOLD' : l.status} domain="lot" />
        {l.type === 'GRADE_SPLIT' && l.gradeCode && <StatusChip status="SPLIT" domain="lot" label={`Grade ${l.gradeCode}`} />}
      </Stack>}
      loading={lot.isLoading}
      error={lot.error}
      figures={l ? [
        { label: 'Current weight', value: <WeightText value={l.currentWeightKg} /> },
        { label: 'Original cherry (root lot)', value: <WeightText value={l.originalCherryWeightKg} /> },
        { label: 'Stage', value: humanize(l.currentStage) },
        { label: 'Processing date', value: l.processingDate },
      ] : []}
      timeline={timeline}
      tabs={l ? [{
        key: 'overview', label: 'Overview',
        content: (
          <Stack spacing={3}>
            <ErrorAlert error={events.error ?? outturn.error} />
            {l.activeHold && (
              <Alert severity="error" action={<Button color="inherit" size="small" component={RouterLink} to="/quality?tab=holds">Holds</Button>}>
                On quality hold{l.activeHold.lotId !== l.id ? ' (through its parent lot)' : ''}: {l.activeHold.reason}. Every processing step is blocked.
              </Alert>
            )}
            <SectionCard title="Journey">
              <JourneyStepper current={l.currentStage} blocked={Boolean(l.activeHold) || l.status === 'REJECTED'} stages={journeyFromEvents(events.data ?? [])} />
            </SectionCard>
            <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, alignItems: 'start' }}>
              <SectionCard title="Outturn so far" subtitle="Weight at each step as a share of the original cherry.">
                <Stack spacing={1.5}>
                  {outturn.data?.steps.map((s) => (
                    <Box key={s.key}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                        <Typography variant="body2">{s.label}</Typography>
                        <Typography variant="body2" color={s.weightKg ? undefined : 'text.secondary'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {s.weightKg ? `${formatNumber(s.weightKg, 3)} kg · ${formatNumber(s.outturnPct, 1)} %` : 'not yet'}
                        </Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={s.outturnPct ? Math.min(Number(s.outturnPct), 100) : 0} sx={{ height: 6, borderRadius: 3 }}
                        aria-label={`${s.label} outturn`} />
                    </Box>
                  ))}
                </Stack>
              </SectionCard>
              <SectionCard title="Details">
                <Stack spacing={2}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    <Field label="Type">{humanize(l.type)}</Field>
                    <Field label="Location">{l.currentLocation}</Field>
                    <Field label="From lot">{l.parentLotId ? <Link component={RouterLink} to={`/lots/${l.parentLotId}`}>{l.parentLotNumber}</Link> : null}</Field>
                    <Field label="Purchase voucher">
                      {l.purchaseVoucherId ? <Can permission="purchase:read" fallback={l.voucherNo}><Link component={RouterLink} to={`/purchases/${l.purchaseVoucherId}`}>{l.voucherNo}</Link></Can> : null}
                    </Field>
                  </Box>
                  {l.children.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>Grade lots</Typography>
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                        {l.children.map((c) => (
                          <Button key={c.id} variant="outlined" size="small" component={RouterLink} to={`/lots/${c.id}`}>
                            {c.lotNumber} · {formatNumber(c.currentWeightKg, 0)} kg · {humanize(c.currentStage)}
                          </Button>
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              </SectionCard>
            </Box>
          </Stack>
        ),
      }] : []}
    />
  );
}
