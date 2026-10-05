import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Button, Divider, Drawer, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ErrorAlert } from '../components/common';
import { FilterBar, type FilterDef } from '../components/FilterBar';
import { PageHeader, type Crumb } from '../components/PageHeader';

export interface QuickView {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Link to the record's own page ("Open"). */
  to?: string;
  children: ReactNode;
}

export interface ListTemplateProps {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  /** The "New …" button; hidden unless the user holds `permission`. */
  create?: { label: string; to: string; permission?: string | string[] };
  /** Extra header actions (export, etc.). */
  actions?: ReactNode;
  filters?: FilterDef[];
  /** Error from the list query. */
  error?: unknown;
  /** The DataTable. */
  children: ReactNode;
  /** Right-hand drawer with a summary of the clicked row. */
  quickView?: QuickView;
}

/**
 * Template 1 — list page (spec §5): PageHeader (title + "New …") → FilterBar →
 * DataTable → optional quick-view drawer on row click.
 */
export function ListTemplate({ title, subtitle, breadcrumbs, create, actions, filters, error, children, quickView }: ListTemplateProps) {
  const { can } = useAuth();
  const showCreate = create && (!create.permission || can(create.permission));
  return (
    <>
      <PageHeader
        title={title} subtitle={subtitle} breadcrumbs={breadcrumbs}
        actions={(showCreate || actions) && <>
          {actions}
          {showCreate && <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to={create.to}>{create.label}</Button>}
        </>}
      />
      {filters && filters.length > 0 && <FilterBar filters={filters} />}
      <ErrorAlert error={error} />
      {children}
      {quickView && (
        <Drawer anchor="right" open={quickView.open} onClose={quickView.onClose}
          slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } }, role: 'dialog', 'aria-label': quickView.title } }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2.5, py: 1.5 }}>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{quickView.title}</Typography>
            {quickView.to && (
              <Tooltip title="Open full page">
                <IconButton component={RouterLink} to={quickView.to} aria-label="Open full page"><OpenInNewIcon /></IconButton>
              </Tooltip>
            )}
            <IconButton onClick={quickView.onClose} aria-label="Close"><CloseIcon /></IconButton>
          </Stack>
          <Divider />
          <Box sx={{ p: 2.5, overflowY: 'auto' }}>{quickView.children}</Box>
        </Drawer>
      )}
    </>
  );
}
