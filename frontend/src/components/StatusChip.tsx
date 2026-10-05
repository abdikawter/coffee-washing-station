import { Chip, type ChipProps } from '@mui/material';
import { statusTone, toneColor, type StatusDomain } from '../theme';
import { humanize } from '../utils/format';

export interface StatusChipProps {
  /** The enum value from the API, e.g. `PENDING_VERIFICATION`. */
  status: string;
  /** Which enum it is — the same word can mean different things (theme/status.ts). */
  domain?: StatusDomain;
  /** Defaults to the humanized value ("Pending verification"). */
  label?: string;
  size?: ChipProps['size'];
}

/** The only way statuses are shown (spec §9): fixed colour meaning, always with a text label. */
export function StatusChip({ status, domain, label, size = 'small' }: StatusChipProps) {
  const tone = statusTone(status, domain);
  return (
    <Chip
      size={size}
      label={label ?? humanize(status)}
      color={toneColor(tone)}
      variant={tone === 'neutral' ? 'outlined' : 'filled'}
      data-tone={tone}
    />
  );
}
