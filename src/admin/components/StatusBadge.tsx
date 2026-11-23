import React from 'react';

const STATUS_STYLES: Record<string, string> = {
  // Positive / Verified
  'QC Verified': 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Completed: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Approved: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Accepted: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Published: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Resolved: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Converted: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  active: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Active: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',
  Responded: 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300',

  // Active / Dispatch
  'In Progress': 'bg-lime-200 text-[#052E16] dark:bg-lime-300/25 dark:text-lime-200',
  Dispatched: 'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',
  Scheduled: 'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',
  'En Route': 'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',
  Assigned: 'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',
  Acknowledged: 'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',
  Contacted: 'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',

  // Review / Pending
  New: 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  'Open Bid': 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  'Bid Review': 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  'Submitted for QC': 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  Pending: 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  'Pending Review': 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  'Under Review': 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  Submitted: 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  Estimating: 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  'Proposal Sent': 'bg-indigo-100 text-indigo-900 dark:bg-indigo-400/20 dark:text-indigo-200',
  Unread: 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-200',
  High: 'bg-orange-100 text-orange-950 dark:bg-orange-400/20 dark:text-orange-200',

  // Urgent / Rejected / Suspended
  Urgent: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-200',
  'QC Rejected': 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-200',
  Rejected: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-200',
  Suspended: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-200',
  suspended: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-200',

  // Neutral / Archived
  Cancelled: 'bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-lime-100/70',
  Archived: 'bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-lime-100/70',
  archived: 'bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-lime-100/70',
  Closed: 'bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-lime-100/70',
  Hidden: 'bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-lime-100/70',
  Withdrawn: 'bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-lime-100/70',
  Normal: 'bg-emerald-950/10 text-[#052E16] dark:bg-white/10 dark:text-lime-100',
  Low: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-lime-100/70',
  Read: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-lime-100/80'
};

export const StatusBadge: React.FC<{ value: string; className?: string }> = ({ value, className = '' }) => {
  const style =
    STATUS_STYLES[value] ?? 'bg-emerald-950/10 text-[#052E16] dark:bg-white/10 dark:text-lime-100';
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${style} ${className}`}
    >
      {value}
    </span>
  );
};
