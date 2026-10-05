import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import type { StatusTone } from '../theme';

export interface ProgressRingProps {
  /** 0–100; values above 100 draw a full ring (e.g. fermentation over max). */
  value: number;
  /** Text in the centre, e.g. "36 h". */
  label: string;
  /** Line under the ring, e.g. "of 24–48 h". */
  caption?: string;
  /** Status colour (theme/status.ts meaning). Default 'info'. */
  tone?: StatusTone;
  size?: number;
  /** Accessible name, e.g. "Fermentation time". */
  ariaLabel?: string;
}

/** Circular progress with a centre label and status colour (fermentation hours, moisture) — spec §4. */
export function ProgressRing({ value, label, caption, tone = 'info', size = 96, ariaLabel }: ProgressRingProps) {
  const pct = Math.max(0, Math.min(100, value));
  const color = tone === 'neutral' ? 'inherit' : tone;
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <CircularProgress variant="determinate" value={100} size={size} thickness={4} sx={{ color: 'divider', position: 'absolute' }} aria-hidden />
        <CircularProgress
          variant="determinate" value={pct} size={size} thickness={4} color={color}
          sx={{ position: 'absolute', ...(tone === 'neutral' && { color: 'text.secondary' }), '& circle': { strokeLinecap: 'round' } }}
          aria-label={ariaLabel ?? label} data-tone={tone}
        />
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Typography variant="subtitle1" component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{label}</Typography>
        </Box>
      </Box>
      {caption && <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>{caption}</Typography>}
    </Stack>
  );
}
