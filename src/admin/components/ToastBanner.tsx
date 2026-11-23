import React from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
  type: 'success' | 'error';
  text: string;
}

export const ToastBanner: React.FC<{
  toast: ToastMessage | null;
  onDismiss: () => void;
}> = ({ toast, onDismiss }) => {
  if (!toast) return null;

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xs ${
        toast.type === 'success'
          ? 'border-emerald-950/15 bg-[#BEF264] text-[#052E16]'
          : 'border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-200'
      }`}
    >
      <div className="flex items-center gap-2">
        {toast.type === 'success' ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span>{toast.text}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded p-1 hover:bg-black/10 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
