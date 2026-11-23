import React from 'react';

interface BarItem {
  label: string;
  value: number;
  sublabel?: string;
}

export const HorizontalBarChart: React.FC<{
  items: BarItem[];
  emptyLabel?: string;
  accentClass?: string;
}> = ({ items, emptyLabel = 'No records in selected period.', accentClass = 'bg-[#052E16] dark:bg-lime-400' }) => {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-[#052E16]/60 dark:text-lime-200/60">
        {emptyLabel}
      </p>
    );
  }

  const maxVal = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const pct = Math.max(4, Math.round((item.value / maxVal) * 100));
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-semibold text-[#052E16] dark:text-lime-100">
                {item.label}
              </span>
              <span className="shrink-0 font-mono-tabular font-bold text-[#052E16] dark:text-lime-300">
                {item.value}
                {item.sublabel ? ` · ${item.sublabel}` : ''}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-emerald-950/10 dark:bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-300 ${accentClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const MonthlyTrendChart: React.FC<{
  data: Array<{ month: string; count: number; value: number }>;
}> = ({ data }) => {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-[#052E16]/60 dark:text-lime-200/60">
        No monthly work order activity in this range.
      </p>
    );
  }

  const maxCount = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="flex h-44 items-end gap-3 pt-4">
      {data.map((d) => {
        const heightPct = Math.max(12, Math.round((d.count / maxCount) * 100));
        return (
          <div key={d.month} className="flex flex-1 flex-col items-center gap-1.5 h-full justify-end">
            <span className="font-mono-tabular text-[11px] font-bold text-[#052E16] dark:text-lime-300">
              {d.count}
            </span>
            <div className="flex w-full max-w-[44px] flex-1 items-end rounded-t-md bg-emerald-950/8 dark:bg-white/5">
              <div
                title={`${d.month}: ${d.count} WOs ($${d.value.toLocaleString()})`}
                className="w-full rounded-t-md bg-[#052E16] dark:bg-lime-400 transition-all duration-300"
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-[#052E16]/75 dark:text-lime-200/75 whitespace-nowrap">
              {d.month}
            </span>
          </div>
        );
      })}
    </div>
  );
};
