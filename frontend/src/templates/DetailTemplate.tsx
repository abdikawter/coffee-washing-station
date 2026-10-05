import { Box, Card, CardContent, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApprovalBar, type ApprovalBarProps } from '../components/ApprovalBar';
import { ErrorAlert, Loading } from '../components/common';
import { PageHeader, type Crumb } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Timeline, type TimelineItem } from '../components/Timeline';

export interface KeyFigure {
  label: string;
  value: ReactNode;
}

export interface DetailTab {
  /** URL value (`?tab=items`). The first tab is the default. */
  key: string;
  label: string;
  /** Count shown next to the label. */
  count?: number;
  content: ReactNode;
}

export interface DetailTemplateProps {
  /** Document / record number, e.g. "PV-2026-0012". */
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  /** StatusChip next to the title. */
  status?: ReactNode;
  /** Header buttons (Print, Edit…). Workflow actions go in `approval`. */
  actions?: ReactNode;
  /** Key figures in the summary card (supplier, net weight, total…). */
  figures?: KeyFigure[];
  /** Overview, Items, History, Documents… */
  tabs: DetailTab[];
  /** Event list beside the tabs (below on phones). Omit to hide. */
  timeline?: TimelineItem[];
  /** Sticky bottom bar for workflow documents. */
  approval?: ApprovalBarProps;
  loading?: boolean;
  error?: unknown;
}

/**
 * Template 2 — detail page (spec §5): summary header card (number, status, key
 * figures, actions) → tabs → timeline; ApprovalBar at the bottom for workflow documents.
 * The open tab is kept in the URL (`?tab=`), so it survives reload and can be linked.
 */
export function DetailTemplate({ title, subtitle, breadcrumbs, status, actions, figures, tabs, timeline, approval, loading, error }: DetailTemplateProps) {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const current = tabs.find((t) => t.key === tabParam) ?? tabs[0];

  const selectTab = (key: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (key === tabs[0]?.key) next.delete('tab'); else next.set('tab', key);
    return next;
  }, { replace: true });

  if (loading) return <><PageHeader title={title} breadcrumbs={breadcrumbs} /><Loading /></>;
  if (error) return <><PageHeader title={title} breadcrumbs={breadcrumbs} /><ErrorAlert error={error} /></>;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} breadcrumbs={breadcrumbs} badge={status} actions={actions} />
      {figures && figures.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
            <Box component="dl" sx={{ m: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
              {figures.map((f) => (
                <Box key={f.label} sx={{ minWidth: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary">{f.label}</Typography>
                  <Typography component="dd" variant="subtitle1" sx={{ m: 0, wordBreak: 'break-word', fontVariantNumeric: 'tabular-nums' }}>{f.value ?? '—'}</Typography>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: timeline ? 'minmax(0, 1fr) 340px' : 'minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Box sx={{ minWidth: 0 }}>
          {tabs.length > 1 && (
            <Tabs value={current?.key ?? false} onChange={(_, k: string) => selectTab(k)} variant="scrollable" allowScrollButtonsMobile
              sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
              {tabs.map((t) => (
                <Tab key={t.key} value={t.key} id={`tab-${t.key}`} aria-controls={`tabpanel-${t.key}`}
                  label={t.count === undefined ? t.label : (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <span>{t.label}</span><Chip size="small" label={t.count} sx={{ height: 20 }} />
                    </Stack>
                  )} />
              ))}
            </Tabs>
          )}
          {current && <Box role="tabpanel" id={`tabpanel-${current.key}`} aria-labelledby={`tab-${current.key}`}>{current.content}</Box>}
        </Box>
        {timeline && <SectionCard title="History"><Timeline items={timeline} /></SectionCard>}
      </Box>
      {approval && <ApprovalBar {...approval} />}
    </>
  );
}
