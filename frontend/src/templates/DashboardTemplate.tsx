import ChevronRight from '@mui/icons-material/ChevronRight';
import { Box, List, ListItem, ListItemButton, ListItemText, Skeleton } from '@mui/material';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';

export interface PanelItem {
  id: string;
  primary: ReactNode;
  secondary?: ReactNode;
  /** StatusChip or count on the right. */
  badge?: ReactNode;
  to?: string;
}

/** List of things to act on — the "Waiting for you" and "Alerts" panels. */
export function PanelList({ items, emptyText, loading }: { items: PanelItem[]; emptyText: string; loading?: boolean }) {
  if (loading) return <Box sx={{ px: 2.5, pb: 2 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}</Box>;
  if (!items.length) return <EmptyState compact title={emptyText} />;
  return (
    <List disablePadding>
      {items.map((it) => {
        const body = <>
          <ListItemText primary={it.primary} secondary={it.secondary} slotProps={{ primary: { variant: 'body2', sx: { fontWeight: 600 } } }} />
          {it.badge}
          {it.to && <ChevronRight color="action" sx={{ ml: 1 }} aria-hidden />}
        </>;
        return it.to
          ? <ListItem key={it.id} disablePadding divider><ListItemButton component={RouterLink} to={it.to} sx={{ px: 2.5, minHeight: 56 }}>{body}</ListItemButton></ListItem>
          : <ListItem key={it.id} divider sx={{ px: 2.5, minHeight: 56 }}>{body}</ListItem>;
      })}
    </List>
  );
}

export interface DashboardTemplateProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** KpiCards (2 per row on phones, up to 5 on desktop). */
  kpis: ReactNode[];
  /** SectionCards with charts. */
  charts?: ReactNode[];
  /** "Waiting for you" (approvals) panel content — usually a PanelList. */
  waiting?: ReactNode;
  /** "Alerts" panel content. */
  alerts?: ReactNode;
}

/** Template 5 — dashboard (spec §5): KPI row → charts row → "Waiting for you" + "Alerts". */
export function DashboardTemplate({ title, subtitle, actions, kpis, charts, waiting, alerts }: DashboardTemplateProps) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} sticky={false} />
      <Box component="section" aria-label="Key figures"
        sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: `repeat(${Math.min(Math.max(kpis.length, 1), 5)}, minmax(0, 1fr))` } }}>
        {kpis}
      </Box>
      {charts && charts.length > 0 && (
        <Box sx={{ display: 'grid', gap: 3, mb: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: charts.length > 1 ? '2fr 1fr' : 'minmax(0, 1fr)' } }}>{charts}</Box>
      )}
      {(waiting || alerts) && (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: waiting && alerts ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' } }}>
          {waiting && <SectionCard title="Waiting for you" disablePadding>{waiting}</SectionCard>}
          {alerts && <SectionCard title="Alerts" disablePadding>{alerts}</SectionCard>}
        </Box>
      )}
    </>
  );
}
