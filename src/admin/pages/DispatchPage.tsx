import React, { useCallback, useEffect, useState } from 'react';
import { Phone, Search, ShieldAlert, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import {
  DISPATCH_STATUSES,
  PRIORITY_LEVELS,
  type DispatchRequestEntity,
  type DispatchStatus,
  type PriorityLevel,
  type VendorRecord
} from '../../types/platform';

export const DispatchPage: React.FC = () => {
  const { hasPermission } = useAdminAuth();
  const [items, setItems] = useState<DispatchRequestEntity[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DispatchRequestEntity | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (priorityFilter !== 'All') params.set('priority', priorityFilter);
      if (search.trim()) params.set('q', search.trim());

      const [dRes, vRes] = await Promise.all([
        apiRequest<{ items: DispatchRequestEntity[] }>(`/api/admin/dispatch?${params.toString()}`),
        hasPermission('vendors.read')
          ? apiRequest<{ items: VendorRecord[] }>('/api/admin/vendors?status=Approved').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] })
      ]);
      setItems(dRes.items);
      setVendors(vRes.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load dispatch queue.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, search, hasPermission]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateDispatch = async (
    id: string,
    payload: {
      status?: DispatchStatus;
      priority?: PriorityLevel;
      assignedVendorId?: string;
      internalNotes?: string;
    }
  ) => {
    try {
      const res = await apiRequest<{ item: DispatchRequestEntity }>(`/api/admin/dispatch/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setToast({ type: 'success', text: `Dispatch ${res.item.dispatchCode} updated.` });
      if (selected && selected.id === id) {
        setSelected(res.item);
        setNotesDraft(res.item.internalNotes);
      }
      await loadData();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Dispatch update failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">24/7 Urgent Dispatch Queue</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Track emergency board-ups, tarping, flood pump-outs, and rapid vendor deployment.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#052E16]/50 dark:text-lime-200/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dispatch code, phone, property, emergency type..."
            className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] py-2 pr-3 pl-9 text-xs dark:border-lime-300/20 dark:bg-[#03170C]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter dispatch status"
          className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
        >
          <option value="All">All Statuses</option>
          {DISPATCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          aria-label="Filter priority"
          className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
        >
          <option value="All">All Priorities</option>
          {PRIORITY_LEVELS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Dispatch List */}
        <div className="space-y-3 lg:col-span-2">
          {loading ? (
            <div className="rounded-xl border border-emerald-950/12 bg-white p-10 text-center text-xs dark:border-lime-300/15 dark:bg-[#072716]">
              Loading urgent dispatch requests...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-emerald-950/12 bg-white p-10 text-center text-xs dark:border-lime-300/15 dark:bg-[#072716]">
              No dispatch requests match your filters.
            </div>
          ) : (
            items.map((d) => (
              <div
                key={d.id}
                className={`rounded-xl border p-4 shadow-xs transition-colors ${
                  selected?.id === d.id
                    ? 'border-[#052E16] bg-lime-50 dark:border-lime-400 dark:bg-[#0B351E]'
                    : 'border-emerald-950/12 bg-white dark:border-lime-300/15 dark:bg-[#072716]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-orange-600" />
                      <span className="font-mono-tabular text-xs font-bold">{d.dispatchCode}</span>
                      <StatusBadge value={d.priority} />
                      <StatusBadge value={d.status} />
                    </div>
                    <h3 className="mt-1 font-display text-sm font-bold">{d.emergencyType}</h3>
                    <p className="text-xs text-[#052E16]/80 dark:text-lime-200/80">{d.propertyAddress}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={`tel:${d.phone}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-950/15 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-lime-100 dark:border-lime-300/20"
                    >
                      <Phone className="h-3 w-3" /> {d.phone}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(d);
                        setNotesDraft(d.internalNotes || '');
                      }}
                      className="rounded-lg bg-[#052E16] px-3 py-1.5 text-[11px] font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                    >
                      Manage
                    </button>
                  </div>
                </div>

                {d.description && (
                  <p className="mt-2 rounded-lg bg-[#F6FAF1] p-2.5 text-xs dark:bg-[#03170C]">{d.description}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#052E16]/70 dark:text-lime-200/70">
                  <span>
                    Contact: <strong>{d.contactName}</strong> · Crew:{' '}
                    <strong>{d.assignedVendorName || 'Unassigned'}</strong>
                  </span>
                  <span>Submitted {new Date(d.submittedDate).toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right Detail / Dispatch Drawer */}
        <div className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716] h-fit">
          {!selected ? (
            <div className="py-10 text-center text-xs text-[#052E16]/60 dark:text-lime-200/60">
              Select a dispatch ticket to assign a field vendor, update response status, and inspect timeline logs.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-emerald-950/10 pb-3 dark:border-lime-300/15">
                <div>
                  <span className="font-mono-tabular text-xs font-bold">{selected.dispatchCode}</span>
                  <h3 className="font-display text-base font-bold">{selected.emergencyType}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close panel"
                  className="rounded p-1 hover:bg-black/5 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold">Dispatch Status</label>
                  <select
                    value={selected.status}
                    disabled={!hasPermission('dispatch.write')}
                    onChange={(e) => void updateDispatch(selected.id, { status: e.target.value as DispatchStatus })}
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  >
                    {DISPATCH_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold">Priority Level</label>
                  <select
                    value={selected.priority}
                    disabled={!hasPermission('dispatch.write')}
                    onChange={(e) => void updateDispatch(selected.id, { priority: e.target.value as PriorityLevel })}
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  >
                    {PRIORITY_LEVELS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold">Assign Approved Crew / Vendor</label>
                  <select
                    value={selected.assignedVendorId || ''}
                    disabled={!hasPermission('dispatch.write')}
                    onChange={(e) => void updateDispatch(selected.id, { assignedVendorId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  >
                    <option value="">-- Unassigned --</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.companyName} ({v.vendorCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold">Internal Coordinator Notes</label>
                  <textarea
                    rows={3}
                    value={notesDraft}
                    disabled={!hasPermission('dispatch.write')}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  />
                  {hasPermission('dispatch.write') && (
                    <button
                      type="button"
                      onClick={() => void updateDispatch(selected.id, { internalNotes: notesDraft })}
                      className="mt-2 rounded-lg bg-[#052E16] px-3 py-1.5 text-[11px] font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                    >
                      Save Notes
                    </button>
                  )}
                </div>
              </div>

              <div className="border-t border-emerald-950/10 pt-3 dark:border-lime-300/15">
                <h4 className="text-xs font-bold">Dispatch Timeline</h4>
                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                  {selected.timeline.map((t) => (
                    <div key={t.id} className="border-l-2 border-lime-500 pl-2.5 text-[11px]">
                      <p className="font-semibold">{t.description}</p>
                      <p className="text-[10px] text-[#052E16]/60 dark:text-lime-200/60">
                        {t.actorName} · {new Date(t.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
