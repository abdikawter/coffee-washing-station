import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { ErrorAlert } from './common';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  /** Dialog stays open and shows the error if this rejects. */
  onConfirm: () => Promise<unknown>;
}

/** Yes / no confirmation for actions that need no written reason. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onClose, onConfirm }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={error} />
        {message && <DialogContentText component="div">{message}</DialogContentText>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={busy} onClick={submit}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
