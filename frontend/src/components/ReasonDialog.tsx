import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';
import { useState } from 'react';
import { ErrorAlert } from './common';

/** Controlled actions in this system require a written reason (audited). */
export function ReasonDialog({
  open, title, message, confirmLabel = 'Confirm', danger, onClose, onConfirm,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {message && <DialogContentText sx={{ mb: 2 }}>{message}</DialogContentText>}
        <ErrorAlert error={error} />
        <TextField autoFocus fullWidth multiline minRows={2} label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}
          helperText="Required, at least 3 characters. Recorded in the audit log." sx={{ mt: 1 }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={busy || reason.trim().length < 3} onClick={submit}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
