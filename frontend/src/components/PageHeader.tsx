import { Box, Breadcrumbs, Link, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Omit on the current page (last crumb). */
  to?: string;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Primary / secondary actions on the right — e.g. a "New voucher" button. */
  actions?: ReactNode;
  /** Status chip or other badge next to the title. */
  badge?: ReactNode;
  /** Stays under the app bar on scroll (spec §4). Default true. */
  sticky?: boolean;
}

/** Page title block used by every page template (spec §5). */
export function PageHeader({ title, subtitle, breadcrumbs, actions, badge, sticky = true }: PageHeaderProps) {
  return (
    <Box
      component="header"
      sx={{
        mb: 3,
        py: 1.5,
        ...(sticky && {
          position: 'sticky',
          top: { xs: 56, sm: 64 }, // below the fixed app bar (MUI toolbar heights)
          zIndex: (t) => t.zIndex.appBar - 1,
          bgcolor: 'background.default',
        }),
      }}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 0.5, typography: 'body2' }}>
          {breadcrumbs.map((c) => (c.to
            ? <Link key={c.label} component={RouterLink} to={c.to} underline="hover" color="text.secondary">{c.label}</Link>
            : <Typography key={c.label} variant="body2" color="text.primary" aria-current="page">{c.label}</Typography>))}
        </Breadcrumbs>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="h4" component="h1" sx={{ wordBreak: 'break-word' }}>{title}</Typography>
            {badge}
          </Stack>
          {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
        </Box>
        {actions && <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: 'wrap', rowGap: 1 }}>{actions}</Stack>}
      </Stack>
    </Box>
  );
}
