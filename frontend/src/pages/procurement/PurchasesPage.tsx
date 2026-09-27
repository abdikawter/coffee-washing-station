import AddIcon from '@mui/icons-material/Add';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Button, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { purchasesApi, type VoucherStatus } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../../components/common';
import { formatNumber } from '../../utils/decimal';
import { humanize } from '../../utils/format';

const STATUSES: VoucherStatus[] = ['DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'APPROVED', 'PAID', 'CANCELLED', 'VOIDED'];

/** Purchase vouchers list (ARCHITECTURE.md §9.1). */
export function PurchasesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useQuery({
    queryKey: ['purchases', { page, pageSize, status, search, from, to }],
    queryFn: () => purchasesApi.list({ page: page + 1, pageSize, status: status || undefined, search: search.trim() || undefined, from: from || undefined, to: to || undefined }),
    placeholderData: keepPreviousData,
  });
  const reset = () => setPage(0);

  return (
    <>
      <PageHeader title="Purchasing" subtitle="Weighing, purchase vouchers, verification and approval"
        actions={<Can permission="purchase:create"><Button variant="contained" size="large" startIcon={<AddIcon />} component={RouterLink} to="/purchases/new">New voucher</Button></Can>} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField size="small" label="Search voucher or supplier" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} sx={{ minWidth: 240 }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} sx={{ minWidth: 200 }}>
          <MenuItem value="">All</MenuItem>
          {STATUSES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
      <ErrorAlert error={q.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Voucher</TableCell><TableCell>Date</TableCell><TableCell>Supplier</TableCell>
                <TableCell align="right">Weight (kg)</TableCell><TableCell align="right">Amount</TableCell><TableCell>Lot</TableCell><TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={7}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((v) => (
                <TableRow key={v.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/purchases/${v.id}`)}>
                  <TableCell>
                    {v.voucherNo}
                    {v.scaleWarning && <Tooltip title={v.scaleWarning}><WarningAmberIcon color="warning" fontSize="small" sx={{ ml: 0.5, verticalAlign: 'middle' }} /></Tooltip>}
                  </TableCell>
                  <TableCell>{v.voucherDate}</TableCell>
                  <TableCell>{v.supplierName} <Typography variant="caption" color="text.secondary">{v.supplierCode}</Typography></TableCell>
                  <TableCell align="right">{formatNumber(v.totalWeightKg, 3)}</TableCell>
                  <TableCell align="right">{formatNumber(v.totalAmount)}</TableCell>
                  <TableCell>{v.lotNumber ?? '—'}</TableCell>
                  <TableCell><StatusChip status={v.status} label={humanize(v.status)} /></TableCell>
                </TableRow>
              ))}
              {q.data?.data.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ p: 2 }}>No vouchers match.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={pageSize}
          onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[10, 25, 50, 100]} />
      </Paper>
    </>
  );
}
