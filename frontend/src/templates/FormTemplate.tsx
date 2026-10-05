import { Box, Button, Paper, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorAlert } from '../components/common';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader, type Crumb } from '../components/PageHeader';

export interface WizardStep {
  label: string;
  content: ReactNode;
  /** Runs before "Next"; return false to stay (e.g. React Hook Form `trigger([...fields])`). */
  validate?: () => boolean | Promise<boolean>;
}

export interface FormTemplateProps {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Called on Save / Submit (and Enter). Use React Hook Form's `handleSubmit(...)`. */
  onSubmit: () => void | Promise<unknown>;
  submitLabel?: string;
  busy?: boolean;
  /** Error from the save call, shown above the bar. */
  error?: unknown;
  /** Unsaved changes: warns before leaving with Cancel or closing / reloading the tab. */
  dirty?: boolean;
  /** Where Cancel goes. Omit to hide Cancel. */
  cancelTo?: string;
  /** Short forms: SectionCards, laid out in two columns (one on phones). */
  children?: ReactNode;
  /** Long forms: a step-by-step wizard instead of `children`. */
  steps?: WizardStep[];
}

/** Two-column grid for SectionCards (one column on phones). Wide sections: `sx={{ gridColumn: '1 / -1' }}`. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>{children}</Box>;
}

/**
 * Template 3 — form page (spec §5): SectionCards in a 2-column grid, or a Stepper
 * wizard for long forms; sticky Save bar; unsaved-changes warning. Inline field
 * validation comes from React Hook Form + Zod in the page.
 */
export function FormTemplate({ title, subtitle, breadcrumbs, onSubmit, submitLabel = 'Save', busy, error, dirty, cancelTo, children, steps }: FormTemplateProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const wizard = Boolean(steps?.length);
  const last = !wizard || step === steps!.length - 1;

  // Browser close / reload with unsaved changes.
  useEffect(() => {
    if (!dirty || busy) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!last) {
      if (await (steps![step]!.validate?.() ?? true)) setStep((s) => s + 1);
      return;
    }
    await onSubmit();
  };

  const cancel = () => { if (dirty) setConfirmLeave(true); else navigate(cancelTo!); };

  return (
    <Box component="form" noValidate onSubmit={submit} aria-label={title}>
      <PageHeader title={title} subtitle={subtitle} breadcrumbs={breadcrumbs} />
      {wizard && (
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }} aria-label="Form steps">
          {steps!.map((s) => <Step key={s.label}><StepLabel>{s.label}</StepLabel></Step>)}
        </Stepper>
      )}
      {wizard ? steps![step]!.content : <FormGrid>{children}</FormGrid>}
      <Paper
        square
        sx={{
          position: 'sticky', bottom: 0, zIndex: (t) => t.zIndex.appBar - 1, mt: 3, mx: { xs: -2, md: -3 }, px: { xs: 2, md: 3 }, py: 1.5,
          borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', boxShadow: 'none',
        }}
      >
        <ErrorAlert error={error} />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
          {dirty && <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>Unsaved changes</Typography>}
          {cancelTo && <Button onClick={cancel} disabled={busy}>Cancel</Button>}
          {wizard && step > 0 && <Button variant="outlined" onClick={() => setStep((s) => s - 1)} disabled={busy}>Back</Button>}
          <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Saving…' : last ? submitLabel : 'Next'}</Button>
        </Stack>
      </Paper>
      {cancelTo && (
        <ConfirmDialog open={confirmLeave} title="Discard changes?" message="What you entered on this page will be lost." confirmLabel="Discard" danger
          onClose={() => setConfirmLeave(false)} onConfirm={async () => { navigate(cancelTo); }} />
      )}
    </Box>
  );
}
