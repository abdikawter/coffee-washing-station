import { Step, StepLabel, Stepper, Typography, useMediaQuery, useTheme } from '@mui/material';
import { humanize, STATION_TIMEZONE } from '../utils/format';
import { formatNumber } from '../utils/decimal';

export interface JourneyStage {
  /** Stage code, e.g. `FERMENTATION`. */
  code: string;
  /** Defaults to the humanized code. */
  label?: string;
  /** Weight at the end of this stage (decimal string, kg). */
  weightKg?: string | null;
  /** Business date or ISO timestamp the stage was reached. */
  date?: string | null;
  /** Extra detail, e.g. who did it. */
  note?: string | null;
}

export interface JourneyStepperProps {
  /** All stages in order (Purchased → … → Warehouse). */
  stages: JourneyStage[];
  /** Code of the stage the lot is in now. */
  current: string;
  /** Lot is on hold / rejected — current stage is drawn as an error. */
  blocked?: boolean;
  /** Force an orientation; default horizontal on desktop, vertical below `md` (spec §4). */
  orientation?: 'horizontal' | 'vertical';
  /** Accessible name. Default "Lot journey". */
  label?: string;
}

/** "05 Oct": business dates (YYYY-MM-DD) as-is, timestamps in the station timezone. */
const shortDate = (d: string) => {
  const dateOnly = d.length === 10;
  const date = new Date(dateOnly ? `${d}T00:00:00Z` : d);
  if (Number.isNaN(date.getTime())) return d;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: dateOnly ? 'UTC' : STATION_TIMEZONE }).format(date);
};

/** Lot stages with the current one highlighted, plus weight and date per stage reached. */
export function JourneyStepper({ stages, current, blocked, orientation, label = 'Lot journey' }: JourneyStepperProps) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const dir = orientation ?? (desktop ? 'horizontal' : 'vertical');
  const activeStep = Math.max(0, stages.findIndex((s) => s.code === current));
  return (
    <Stepper activeStep={activeStep} orientation={dir} alternativeLabel={dir === 'horizontal'} aria-label={label}>
      {stages.map((s, i) => {
        const reached = i <= activeStep;
        const detail = [s.note, s.weightKg ? `${formatNumber(s.weightKg, 0)} kg` : null, s.date ? shortDate(s.date) : null].filter(Boolean).join(' · ');
        return (
          <Step key={s.code} completed={i < activeStep} aria-current={i === activeStep ? 'step' : undefined}>
            <StepLabel
              error={blocked && i === activeStep}
              optional={reached && detail ? <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{detail}</Typography> : undefined}
            >
              {s.label ?? humanize(s.code)}
            </StepLabel>
          </Step>
        );
      })}
    </Stepper>
  );
}
