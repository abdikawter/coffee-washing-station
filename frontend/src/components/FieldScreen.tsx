import ArrowBack from '@mui/icons-material/ArrowBack';
import { Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import type { FormEvent, ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

/** Spread into a weight / moisture TextField's `slotProps.htmlInput` for the phone's numeric keypad. */
export const decimalInput = { inputMode: 'decimal', pattern: '[0-9]*[.,]?[0-9]*' } as const;

export interface FieldScreenProps {
  /** One task, e.g. "Record moisture". */
  title: string;
  /** Context line, e.g. the bed or lot number. */
  subtitle?: ReactNode;
  /** Back link (top left). */
  backTo?: string;
  children: ReactNode;
  submitLabel: string;
  onSubmit: () => void;
  submitDisabled?: boolean;
  busy?: boolean;
  /** Optional second button under the main one (e.g. "Skip"). */
  secondary?: ReactNode;
}

/**
 * Mobile field task layout (spec §5.4): big title, one task, inputs and buttons
 * ≥ 48 px, a full-width confirm button pinned to the bottom, usable one-handed.
 */
export function FieldScreen({ title, subtitle, backTo, children, submitLabel, onSubmit, submitDisabled, busy, secondary }: FieldScreenProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!submitDisabled && !busy) onSubmit();
  };
  return (
    <Box
      component="form"
      noValidate
      onSubmit={submit}
      aria-label={title}
      sx={{
        maxWidth: 560, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
        // Field use: gloves and sunlight — larger targets and text everywhere inside.
        '& .MuiInputBase-root': { minHeight: 56, fontSize: '1.125rem' },
        '& .MuiButton-root, & .MuiToggleButton-root': { minHeight: 48 },
        '& .MuiIconButton-root': { minWidth: 48, minHeight: 48 },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {backTo && <IconButton component={RouterLink} to={backTo} aria-label="Back" edge="start"><ArrowBack /></IconButton>}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1">{title}</Typography>
          {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
        </Box>
      </Stack>
      <Stack spacing={2}>{children}</Stack>
      <Paper
        square
        sx={{ position: 'sticky', bottom: 0, mx: -2, px: 2, py: 1.5, mt: 'auto', bgcolor: 'background.default', boxShadow: 'none' }}
      >
        <Stack spacing={1}>
          <Button type="submit" variant="contained" size="large" fullWidth disabled={submitDisabled || busy} sx={{ minHeight: 56, fontSize: '1.0625rem' }}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
          {secondary}
        </Stack>
      </Paper>
    </Box>
  );
}
