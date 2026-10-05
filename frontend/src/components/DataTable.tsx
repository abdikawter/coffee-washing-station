import DensityMediumOutlined from '@mui/icons-material/DensityMediumOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import ViewColumnOutlined from '@mui/icons-material/ViewColumnOutlined';
import { Box, Tooltip } from '@mui/material';
import {
  ColumnsPanelTrigger, DataGrid, ExportCsv, Toolbar, ToolbarButton,
  type GridColDef, type GridDensity, type GridSlotProps, type GridRowIdGetter, type GridSortModel, type GridValidRowModel,
} from '@mui/x-data-grid';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StatusDomain } from '../theme';
import { formatDateTime } from '../utils/format';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { PAGE_SIZES, type TableState } from './listState';
import { MoneyText, PercentText, WeightText } from './NumberText';
import { StatusChip } from './StatusChip';

declare module '@mui/x-data-grid' {
  interface ToolbarPropsOverrides {
    density: GridDensity;
    onDensity: (d: GridDensity) => void;
    csvName: string;
  }
}

const DENSITIES: GridDensity[] = ['standard', 'compact', 'comfortable'];

function TableToolbar({ density, onDensity, csvName }: GridSlotProps['toolbar']) {
  const next = DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length]!;
  return (
    <Toolbar>
      <Tooltip title="Columns">
        <ColumnsPanelTrigger render={<ToolbarButton aria-label="Choose columns" />}><ViewColumnOutlined fontSize="small" /></ColumnsPanelTrigger>
      </Tooltip>
      <Tooltip title={`Row density: ${density} (click for ${next})`}>
        <ToolbarButton aria-label="Change row density" onClick={() => onDensity(next)}><DensityMediumOutlined fontSize="small" /></ToolbarButton>
      </Tooltip>
      <Tooltip title="Export shown rows (CSV)">
        <ExportCsv render={<ToolbarButton aria-label="Export CSV" />} options={{ fileName: csvName, utf8WithBom: true }}>
          <FileDownloadOutlined fontSize="small" />
        </ExportCsv>
      </Tooltip>
    </Toolbar>
  );
}

export interface DataTableProps<R extends GridValidRowModel> {
  /** Accessible name of the grid, e.g. "Purchase vouchers". */
  label: string;
  rows: R[];
  columns: GridColDef<R>[];
  loading?: boolean;
  /**
   * Server mode (from `useTableQuery`): pagination and sort are done by the API.
   * Omit for small lists the API returns whole (client-side paging and sort).
   */
  server?: { state: TableState; rowCount: number; sortFields: readonly string[] };
  /** Row click → this URL (the record's own page). */
  rowTo?: (row: R) => string;
  onRowClick?: (row: R) => void;
  getRowId?: GridRowIdGetter<R>;
  empty?: EmptyStateProps;
  /** CSV file name (no extension). */
  exportName?: string;
}

/**
 * Every list page's table (spec §4): MUI X DataGrid with server-side pagination /
 * sort matching the API (`page`, `pageSize`, `sort=-field`), a toolbar (columns,
 * density, CSV export), row click → detail page and an empty state.
 */
export function DataTable<R extends GridValidRowModel>({
  label, rows, columns, loading, server, rowTo, onRowClick, getRowId, empty, exportName,
}: DataTableProps<R>) {
  const navigate = useNavigate();
  const [density, setDensity] = useState<GridDensity>('standard');

  // Server mode: only the API's whitelisted sort fields are sortable.
  const cols = useMemo(() => (server
    ? columns.map((c) => ({ ...c, sortable: server.sortFields.includes(c.field) }))
    : columns), [columns, server]);

  const sortModel: GridSortModel | undefined = server
    ? (server.state.sort ? [{ field: server.state.sort.replace(/^-/, ''), sort: server.state.sort.startsWith('-') ? 'desc' : 'asc' }] : [])
    : undefined;

  const clickable = Boolean(rowTo || onRowClick);
  return (
    <Box sx={{ width: '100%', '& .MuiDataGrid-row': { cursor: clickable ? 'pointer' : 'default' } }}>
      <DataGrid<R>
        label={label}
        aria-label={label}
        rows={rows}
        columns={cols}
        getRowId={getRowId}
        loading={loading}
        autoHeight
        density={density}
        onDensityChange={setDensity}
        disableColumnFilter
        pageSizeOptions={[...PAGE_SIZES]}
        {...(server
          ? {
            paginationMode: 'server' as const,
            sortingMode: 'server' as const,
            rowCount: server.rowCount,
            paginationModel: { page: server.state.page, pageSize: server.state.pageSize },
            onPaginationModelChange: (m: { page: number; pageSize: number }) => server.state.setPage(m.page, m.pageSize),
            sortModel,
            onSortModelChange: (m: GridSortModel) => {
              const s = m[0];
              server.state.setSort(s?.sort ? `${s.sort === 'desc' ? '-' : ''}${s.field}` : undefined);
            },
          }
          : { initialState: { pagination: { paginationModel: { pageSize: 25 } } } })}
        onRowClick={clickable ? (p) => { if (rowTo) navigate(rowTo(p.row)); else onRowClick?.(p.row); } : undefined}
        showToolbar
        slots={{
          toolbar: TableToolbar,
          noRowsOverlay: () => <EmptyState compact title="Nothing here yet" {...empty} />,
        }}
        slotProps={{
          toolbar: { density, onDensity: setDensity, csvName: exportName ?? label },
          loadingOverlay: { variant: 'skeleton', noRowsVariant: 'skeleton' },
        }}
        sx={{ '--DataGrid-overlayHeight': '260px' }}
      />
    </Box>
  );
}

/** Ready-made column definitions so numbers, statuses and dates look the same in every table. */
type Col<R extends GridValidRowModel> = Partial<GridColDef<R>>;
const numeric = { align: 'right', headerAlign: 'right', minWidth: 120 } as const;

export const columns = {
  money: <R extends GridValidRowModel>(field: string, headerName: string, extra: Col<R> = {}): GridColDef<R> => ({
    field, headerName, ...numeric, renderCell: (p) => <MoneyText value={p.value as string | null} hideUnit />, ...extra,
  }),
  weight: <R extends GridValidRowModel>(field: string, headerName: string, extra: Col<R> = {}): GridColDef<R> => ({
    field, headerName, ...numeric, renderCell: (p) => <WeightText value={p.value as string | null} hideUnit />, ...extra,
  }),
  percent: <R extends GridValidRowModel>(field: string, headerName: string, extra: Col<R> = {}): GridColDef<R> => ({
    field, headerName, ...numeric, renderCell: (p) => <PercentText value={p.value as string | null} hideUnit />, ...extra,
  }),
  status: <R extends GridValidRowModel>(field: string, headerName: string, domain: StatusDomain, extra: Col<R> = {}): GridColDef<R> => ({
    field, headerName, minWidth: 150, renderCell: (p) => (p.value ? <StatusChip status={String(p.value)} domain={domain} /> : '—'), ...extra,
  }),
  dateTime: <R extends GridValidRowModel>(field: string, headerName: string, extra: Col<R> = {}): GridColDef<R> => ({
    field, headerName, minWidth: 170, valueFormatter: (v: string | null) => formatDateTime(v), ...extra,
  }),
};
