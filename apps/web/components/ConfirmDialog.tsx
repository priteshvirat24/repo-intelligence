'use client';

import React, { useRef } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useDialog } from '@/lib/ui/useDialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The one styled replacement for window.confirm(). Cancel is focused first for destructive actions. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  error,
  onConfirm,
  onCancel
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, () => {
    if (!busy) onCancel();
  }, open);

  if (!open) return null;

  return (
    <div
      className="overlay"
      style={{ zIndex: 120 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={ref}
        className="modal modal-sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={children ? 'confirm-body' : undefined}
      >
        <h2 id="confirm-title" className="modal-title" style={{ fontSize: 'var(--fs-lg)', overflowWrap: 'anywhere' }}>
          {title}
        </h2>
        {children && (
          <div id="confirm-body" className="small muted" style={{ marginTop: 'var(--s-3)', lineHeight: 1.55 }}>
            {children}
          </div>
        )}
        {error && (
          <div className="callout callout-danger" role="alert" style={{ marginTop: 'var(--s-4)' }}>
            <AlertCircle size={15} aria-hidden="true" />
            <div>{error}</div>
          </div>
        )}
        <div className="modal-actions" style={{ marginTop: 'var(--s-5)' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy} data-autofocus={tone === 'danger' ? true : undefined}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
            data-autofocus={tone === 'danger' ? undefined : true}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
