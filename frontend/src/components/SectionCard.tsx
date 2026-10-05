import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export interface SectionCardProps {
  title?: string;
  subtitle?: ReactNode;
  /** Buttons / links on the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  /** No inner padding (tables or lists that touch the card edges). */
  disablePadding?: boolean;
}

/** Card with a title that groups one section of a form or detail page (spec §4). */
export function SectionCard({ title, subtitle, actions, children, disablePadding }: SectionCardProps) {
  const headed = Boolean(title || actions);
  return (
    <Card component="section" aria-label={title}>
      {headed && (
        <Stack direction="row" spacing={2} sx={{ px: 2.5, pt: 2, pb: disablePadding ? 2 : 0, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            {title && <Typography variant="h6" component="h2">{title}</Typography>}
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {actions && <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>{actions}</Stack>}
        </Stack>
      )}
      {disablePadding ? children : <CardContent sx={{ px: 2.5, '&:last-child': { pb: 2.5 } }}>{children}</CardContent>}
    </Card>
  );
}
