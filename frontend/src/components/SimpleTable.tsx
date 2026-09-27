import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { formatDateTime, humanize } from '../utils/format';
import { StatusChip } from './common';

/** Small read-only table: status/decision/result columns become chips, *At columns are formatted as times. */
export function SimpleTable<T extends object>({ rows, cols }: { rows: T[]; cols: [keyof T & string, string][] }) {
  if (!rows.length) return <Typography color="text.secondary" sx={{ p: 2 }}>Nothing yet.</Typography>;
  const cell = (v: unknown, key: string) =>
    (key === 'status' || key === 'decision' || key === 'result') && v ? <StatusChip status={String(v)} label={humanize(String(v))} />
      : /At$/.test(key) ? formatDateTime(v as string) : String(v ?? '—');
  return (
    <TableContainer>
      <Table size="small">
        <TableHead><TableRow>{cols.map(([, label]) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.map((r, i) => <TableRow key={i}>{cols.map(([k]) => <TableCell key={k}>{cell(r[k], k)}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
