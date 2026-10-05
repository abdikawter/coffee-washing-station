import { Button, Paper, Stack, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { ErrorAlert } from './common';
import { ConfirmDialog } from './ConfirmDialog';
import { ReasonDialog } from './ReasonDialog';

export interface ApprovalAction {
  key: string;
  label: string;
  /** Hidden unless the user holds one of these (the API re-checks). */
  permission?: string | string[];
  /** Allowed in the document's current state — e.g. `status === 'VERIFIED'` for Approve. Hidden when false. */
  allowed: boolean;
  /** Opens the reason dialog; the reason is passed to `run` (audited). */
  requiresReason?: boolean;
  /** Ask "are you sure?" first (when no reason is needed). */
  confirm?: string;
  /** Red button (Reject, Void, Cancel). */
  danger?: boolean;
  /** The main action is the filled button; others are outlined. */
  primary?: boolean;
  run: (reason?: string) => Promise<unknown>;
}

export interface ApprovalBarProps {
  actions: ApprovalAction[];
  /** Left side text, e.g. "Waiting for verification". */
  hint?: ReactNode;
}

/**
 * Sticky bottom bar on workflow documents (spec §4): shows only the actions the
 * user may take in the document's current state; reason / confirm dialogs built in.
 * Renders nothing when no action is available.
 */
export function ApprovalBar({ actions, hint }: ApprovalBarProps) {
  const { can } = useAuth();
  const [pending, setPending] = useState<ApprovalAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const visible = actions.filter((a) => a.allowed && (!a.permission || can(a.permission)));
  if (!visible.length) return null;

  const start = async (a: ApprovalAction) => {
    if (a.requiresReason || a.confirm) { setPending(a); return; }
    setBusy(a.key);
    setError(null);
    try { await a.run(); } catch (e) { setError(e); } finally { setBusy(null); }
  };

  return (
    <>
      <Paper
        role="toolbar"
        aria-label="Document actions"
        square
        sx={{
          position: 'sticky', bottom: 0, zIndex: (t) => t.zIndex.appBar - 1, mt: 3, mx: { xs: -2, md: -3 }, px: { xs: 2, md: 3 }, py: 1.5,
          borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', boxShadow: 'none',
        }}
      >
        <ErrorAlert error={error} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">{hint}</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, justifyContent: 'flex-end' }}>
            {visible.map((a) => (
              <Button key={a.key} variant={a.primary ? 'contained' : 'outlined'} color={a.danger ? 'error' : 'primary'}
                disabled={busy !== null} onClick={() => void start(a)}>
                {a.label}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Paper>
      <ReasonDialog open={Boolean(pending?.requiresReason)} title={pending?.label ?? ''} confirmLabel={pending?.label} danger={pending?.danger}
        message={pending?.confirm} onClose={() => setPending(null)} onConfirm={(reason) => pending!.run(reason)} />
      <ConfirmDialog open={Boolean(pending && !pending.requiresReason)} title={pending?.label ?? ''} message={pending?.confirm}
        confirmLabel={pending?.label} danger={pending?.danger} onClose={() => setPending(null)} onConfirm={() => pending!.run()} />
    </>
  );
}
