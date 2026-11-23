import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="fixed inset-0 bg-emerald-950/60 backdrop-blur-xs" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                destructive
                  ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                  : 'bg-lime-200 text-[#052E16]'
              }`}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 id="confirm-dialog-title" className="font-display text-lg font-bold text-[#052E16] dark:text-lime-50">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close dialog"
            className="rounded-md p-1 text-[#052E16]/60 hover:bg-emerald-950/5 dark:text-lime-200/70 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[#052E16]/80 dark:text-lime-100/80">
          {description}
        </p>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-emerald-950/15 px-4 py-2 text-xs font-semibold text-[#052E16] hover:bg-emerald-950/5 dark:border-lime-300/25 dark:text-lime-100 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
              destructive
                ? 'bg-red-700 text-white hover:bg-red-800'
                : 'bg-[#052E16] text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16]'
            }`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
