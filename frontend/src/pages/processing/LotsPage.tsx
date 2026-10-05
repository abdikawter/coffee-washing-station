import { Stack, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LOT_STAGES, lotsApi, type Lot } from '../../api/processing';
import { columns as col, DataTable, StatusChip, useTableQuery, useUrlFilters } from '../../components';
import { ListTemplate } from '../../templates';
import { humanize } from '../../utils/format';

const STATUSES = ['ACTIVE', 'ON_HOLD', 'SPLIT', 'IN_STORE', 'RELEASED', 'REJECTED', 'CLOSED'];

/** Lots: every purchase lot and grade lot, searchable by number, supplier, stage and status. */
export function LotsPage() {
  const { table, apiParams } = useTableQuery();
  const { get } = useUrlFilters();
  const filters = { search: get('search') || undefined, stage: get('stage') || undefined, status: get('status') || undefined };
  const q = useQuery({
    queryKey: ['lots', apiParams, filters],
    queryFn: () => lotsApi.list({ ...apiParams, ...filters }),
    placeholderData: keepPreviousData,
  });
  const columns: GridColDef<Lot>[] = [
    {
      field: 'lotNumber', headerName: 'Lot', minWidth: 170,
      renderCell: (p) => (
        <Stack sx={{ lineHeight: 1.3 }}>
          <span>{p.row.lotNumber}</span>
          {p.row.parentLotNumber && <Typography variant="caption" color="text.secondary">from {p.row.parentLotNumber}</Typography>}
        </Stack>
      ),
    },
    { field: 'supplierName', headerName: 'Supplier', flex: 1, minWidth: 180 },
    {
      field: 'currentStage', headerName: 'Stage', minWidth: 190,
      renderCell: (p) => <StatusChip status={p.row.currentStage} domain="lotStage" label={`${humanize(p.row.currentStage)}${p.row.gradeCode ? ` · ${p.row.gradeCode}` : ''}`} />,
    },
    col.weight<Lot>('currentWeightKg', 'Current (kg)'),
    col.weight<Lot>('originalCherryWeightKg', 'Cherry (kg)'),
    {
      field: 'status', headerName: 'Status', minWidth: 130,
      renderCell: (p) => <StatusChip status={p.row.onHold ? 'ON_HOLD' : p.row.status} domain="lot" />,
    },
    { field: 'processingDate', headerName: 'Processing date', minWidth: 140 },
  ];
  return (
    <ListTemplate title="Lots & traceability" subtitle="Every lot from purchase to grade lots, with its full event history" error={q.error}
      filters={[
        { type: 'search', key: 'search', label: 'Lot number or supplier' },
        { type: 'select', key: 'stage', label: 'Stage', options: LOT_STAGES.map((s) => ({ value: s, label: humanize(s) })) },
        { type: 'select', key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
      ]}>
      <DataTable label="Lots" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['lotNumber', 'processingDate'] }}
        rowTo={(l) => `/lots/${l.id}`} empty={{ title: 'No lots match', message: 'Lots are created when a voucher is paid.' }} />
    </ListTemplate>
  );
}
