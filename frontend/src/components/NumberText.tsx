import { Box, type SxProps, type Theme } from '@mui/material';
import { formatNumber } from '../utils/decimal';

/**
 * Decimal strings from the API → display text (spec §4). Values are never parsed
 * into floats; `formatNumber` rounds on the string itself.
 */
export interface NumberTextProps {
  value: string | null | undefined;
  /** Decimal places shown. */
  dp?: number;
  /** Hide the unit (e.g. in a column whose header already says "kg"). */
  hideUnit?: boolean;
  sx?: SxProps<Theme>;
}

function NumberText({ value, dp, unit, hideUnit, sx }: NumberTextProps & { unit: string; dp: number }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <Box component="span" sx={[{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {formatNumber(value, dp)}
      {!empty && !hideUnit && <Box component="span" sx={{ color: 'text.secondary', ml: 0.5, fontSize: '0.85em' }}>{unit}</Box>}
    </Box>
  );
}

/** Birr amount: "12,345.50 ETB". */
export function MoneyText({ dp = 2, ...p }: NumberTextProps) {
  return <NumberText {...p} dp={dp} unit="ETB" />;
}

/** Weight: "1,234.500 kg" (3 dp = stored precision; pass dp={0} for summaries). */
export function WeightText({ dp = 3, ...p }: NumberTextProps) {
  return <NumberText {...p} dp={dp} unit="kg" />;
}

/** Percentage: "62.50 %". */
export function PercentText({ dp = 2, ...p }: NumberTextProps) {
  return <NumberText {...p} dp={dp} unit="%" />;
}
