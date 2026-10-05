import AddIcon from '@mui/icons-material/Add';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Button, Stack, Tooltip } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { purchasesApi, type VoucherStatus, type VoucherSummary } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { columns as col, DataTable, useTableQuery, useUrlFilters } from '../../components';
import { ListTemplate } from '../../templates';
import { humanize } from '../../utils/format';

const STATUSES: VoucherStatus[] = ['DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'APPROVED', 'PAID', 'CANCELLED', 'VOIDED'];

/** Purchase vouchers list (ARCHITECTURE.md §9.1). */
export function PurchasesPage() {
  const { table, apiParams } = useTableQuery();
  const { get } = useUrlFilters();
  const filters = { status: get('status') || undefined, search: get('search') || undefined, from: get('from') || undefined, to: get('to') || undefined };
  const q = useQuery({
    queryKey: ['purchases', apiParams, filters],
    queryFn: () => purchasesApi.list({ ...apiParams, ...filters }),
    placeholderData: keepPreviousData,
  });

  const columns: GridColDef<VoucherSummary>[] = [
    {
      field: 'voucherNo', headerName: 'Voucher', minWidth: 160,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <span>{p.row.voucherNo}</span>
          {p.row.scaleWarning && <Tooltip title={p.row.scaleWarning}><WarningAmberIcon color="warning" fontSize="small" aria-label={`Scale warning: ${p.row.scaleWarning}`} /></Tooltip>}
        </Stack>
      ),
    },
    { field: 'voucherDate', headerName: 'Date', minWidth: 110 },
    { field: 'supplierName', headerName: 'Supplier', flex: 1, minWidth: 200, valueGetter: (_v, v) => `${v.supplierName} (${v.supplierCode})` },
    col.weight<VoucherSummary>('totalWeightKg', 'Weight (kg)'),
    col.money<VoucherSummary>('totalAmount', 'Amount (ETB)'),
    { field: 'lotNumber', headerName: 'Lot', minWidth: 150 },
    col.status<VoucherSummary>('status', 'Status', 'voucher', { minWidth: 170 }),
  ];

  return (
    <ListTemplate title="Purchasing" subtitle="Weighing, purchase vouchers, verification and approval" error={q.error}
      actions={<Can permission="purchase:create"><Button variant="contained" size="large" startIcon={<AddIcon />} component={RouterLink} to="/purchases/new">New voucher</Button></Can>}
      filters={[
        { type: 'search', key: 'search', label: 'Search voucher or supplier' },
        { type: 'select', key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
        { type: 'dateRange', key: 'date' },
      ]}>
      <DataTable label="Purchase vouchers" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['voucherNo', 'voucherDate', 'totalAmount'] }}
        rowTo={(v) => `/purchases/${v.id}`}
        empty={{ title: 'No vouchers match', message: 'Change the filters, or weigh accepted cherry to create a voucher.', action: { label: 'New voucher', to: '/purchases/new' } }} />
    </ListTemplate>
  );
}
