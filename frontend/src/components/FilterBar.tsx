import SearchIcon from '@mui/icons-material/Search';
import { Button, InputAdornment, MenuItem, Stack, TextField } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useUrlFilters } from './listState';

export type FilterDef =
  | { type: 'search'; key: string; label?: string }
  | { type: 'select'; key: string; label: string; options: { value: string; label: string }[] }
  /** Two date pickers writing YYYY-MM-DD to `fromKey` / `toKey` (default `from` / `to`). */
  | { type: 'dateRange'; key: string; label?: string; fromKey?: string; toKey?: string };

const DATE = 'YYYY-MM-DD';
const toDay = (v: string): Dayjs | null => (v ? dayjs(v) : null); // ISO YYYY-MM-DD parses natively
const fromDay = (d: Dayjs | null): string => (d && d.isValid() ? d.format(DATE) : '');

/** Search box that writes to the URL 300 ms after typing stops. */
function SearchFilter({ urlKey, label }: { urlKey: string; label: string }) {
  const { get, set } = useUrlFilters();
  const urlValue = get(urlKey);
  const [text, setText] = useState(urlValue);
  useEffect(() => { setText(urlValue); }, [urlValue]);
  useEffect(() => {
    if (text.trim() === urlValue) return undefined;
    const t = setTimeout(() => set({ [urlKey]: text.trim() }), 300);
    return () => clearTimeout(t);
  }, [text, urlValue, urlKey, set]);
  return (
    <TextField
      size="small" label={label} value={text} onChange={(e) => setText(e.target.value)} sx={{ minWidth: { sm: 240 } }}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
    />
  );
}

/**
 * Filters above a DataTable (spec §4), kept in the URL query string so the list
 * can be bookmarked. Pages read the same values with `useUrlFilters().get(key)`.
 */
export function FilterBar({ filters }: { filters: FilterDef[] }) {
  const { get, set } = useUrlFilters();
  const keys = filters.flatMap((f) => (f.type === 'dateRange' ? [f.fromKey ?? 'from', f.toKey ?? 'to'] : [f.key]));
  const active = keys.some((k) => get(k));
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ mb: 2, flexWrap: 'wrap', alignItems: { sm: 'center' } }} role="search">
      {filters.map((f) => {
        if (f.type === 'search') return <SearchFilter key={f.key} urlKey={f.key} label={f.label ?? 'Search'} />;
        if (f.type === 'select') {
          return (
            <TextField key={f.key} select size="small" label={f.label} value={get(f.key)} onChange={(e) => set({ [f.key]: e.target.value })} sx={{ minWidth: 160 }}>
              <MenuItem value="">All</MenuItem>
              {f.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          );
        }
        const fromKey = f.fromKey ?? 'from';
        const toKey = f.toKey ?? 'to';
        const prefix = f.label ? `${f.label} ` : '';
        return (
          <Stack key={f.key} direction="row" spacing={1}>
            <DatePicker label={`${prefix}from`} value={toDay(get(fromKey))} maxDate={toDay(get(toKey)) ?? undefined}
              onChange={(d) => set({ [fromKey]: fromDay(d) })} slotProps={{ textField: { size: 'small', sx: { width: 170 } }, field: { clearable: true } }} />
            <DatePicker label={`${prefix}to`} value={toDay(get(toKey))} minDate={toDay(get(fromKey)) ?? undefined}
              onChange={(d) => set({ [toKey]: fromDay(d) })} slotProps={{ textField: { size: 'small', sx: { width: 170 } }, field: { clearable: true } }} />
          </Stack>
        );
      })}
      {active && <Button onClick={() => set(Object.fromEntries(keys.map((k) => [k, ''])))}>Clear filters</Button>}
    </Stack>
  );
}
