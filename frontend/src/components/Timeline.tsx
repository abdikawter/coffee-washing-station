import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { StatusTone } from '../theme';
import { formatDateTime } from '../utils/format';
import { EmptyState } from './EmptyState';

export interface TimelineItem {
  id: string;
  title: ReactNode;
  /** ISO timestamp — shown in the station timezone. */
  at: string;
  /** Who did it. */
  by?: string | null;
  description?: ReactNode;
  /** Dot colour (theme/status.ts meaning). Default 'neutral'. */
  tone?: StatusTone;
}

const dotColor = (tone: StatusTone) => (tone === 'neutral' ? 'text.secondary' : `${tone}.main`);

/** Vertical event list — lot events, approvals, audit trail (spec §4). Newest first is the caller's choice. */
export function Timeline({ items, emptyText = 'No events yet.' }: { items: TimelineItem[]; emptyText?: string }) {
  if (!items.length) return <EmptyState compact title={emptyText} />;
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {items.map((it, i) => (
        <Box component="li" key={it.id} sx={{ display: 'flex', gap: 1.5 }}>
          <Stack sx={{ alignItems: 'center', pt: 0.75 }} aria-hidden>
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: dotColor(it.tone ?? 'neutral'), flexShrink: 0 }} />
            {i < items.length - 1 && <Box sx={{ width: 2, flexGrow: 1, bgcolor: 'divider', my: 0.5 }} />}
          </Stack>
          <Box sx={{ pb: i < items.length - 1 ? 2.5 : 0, minWidth: 0 }}>
            <Typography variant="subtitle2" component="div">{it.title}</Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              <time dateTime={it.at}>{formatDateTime(it.at)}</time>{it.by ? ` · ${it.by}` : ''}
            </Typography>
            {it.description && <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>{it.description}</Typography>}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
