import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { BID_REQUEST_STATUSES, type BidRequestEntity, type BidRequestStatus } from '../../types/platform';

export const BidRequestsPage: React.FC = () => {
  const { hasPermission } = useAdminAuth();
  const [items, setItems] = useState<BidRequestEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (search.trim()) params.set('q', search.trim());
      const res = await apiRequest<{ items: BidRequestEntity[] }>(`/api/admin/bid-requests?${params.toString()}`);
      setItems(res.items);
      setPage(1);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load bid requests.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleStatusChange = async (id: string, status: BidRequestStatus) => {
    try {
      await apiRequest(`/api/admin/bid-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      setToast({ type: 'success', text: `Bid request status updated to ${status}.` });
      await loadItems();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update status.' });
    }
  };

  const handleConvert = async (id: string) => {
    try {
      const res = await apiRequest<{ workOrder: { id: string; workOrderCode: string } }>(
        `/api/admin/bid-requests/${id}/convert`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setToast({ type: 'success', text: `Converted into Work Order ${res.workOrder.workOrderCode}.` });
      await loadItems();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Conversion failed.' });
    }
  };

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginated = items.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Customer Bid &amp; Quote Requests</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Review instant estimator leads, attach internal pricing notes, and convert approved quotes to work orders.
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
            placeholder="Search by code, contact, email, address, service..."
            className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] py-2 pr-3 pl-9 text-xs text-[#052E16] dark:border-lime-300/20 dark:bg-[#03170C] dark:text-lime-50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs font-semibold text-[#052E16] dark:border-lime-300/20 dark:bg-[#03170C] dark:text-lime-50"
        >
          <option value="All">All Statuses</option>
          {BID_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-emerald-950/12 bg-white shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
        {loading ? (
          <div className="py-12 text-center text-xs text-[#052E16]/70 dark:text-lime-200/70">
            Loading bid requests...
          </div>
        ) : paginated.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#052E16]/70 dark:text-lime-200/70">
            No customer bid requests match the active filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-emerald-950/10 bg-[#F6FAF1] text-[11px] font-bold uppercase tracking-wide text-[#052E16]/70 dark:border-lime-300/15 dark:bg-[#052312] dark:text-lime-300">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Property &amp; Scope</th>
                  <th className="px-4 py-3">Estimator Range</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                {paginated.map((b) => (
                  <tr key={b.id} className="hover:bg-[#F6FAF1]/70 dark:hover:bg-white/5">
                    <td className="px-4 py-3 font-mono-tabular font-bold">
                      <Link to={`/admin/bid-requests/${b.id}`} className="text-emerald-800 hover:underline dark:text-lime-300">
                        {b.requestCode}
                      </Link>
                      <div className="mt-0.5 text-[10px] font-normal text-[#052E16]/60 dark:text-lime-200/60">
                        {new Date(b.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#052E16] dark:text-lime-50">{b.contactName}</div>
                      <div className="text-[11px] text-[#052E16]/70 dark:text-lime-200/75">{b.email}</div>
                      <div className="text-[11px] text-[#052E16]/70 dark:text-lime-200/75">{b.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#052E16] dark:text-lime-50">{b.propertyAddress}</div>
                      <div className="text-[11px] text-[#052E16]/75 dark:text-lime-200/75">{b.requestedServices}</div>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular">
                      {b.estimatorData ? (
                        <div>
                          <span className="font-bold text-[#052E16] dark:text-lime-300">
                            ${b.estimatorData.lowEstimate.toLocaleString()} – ${b.estimatorData.highEstimate.toLocaleString()}
                          </span>
                          <div className="text-[10px] text-[#052E16]/65 dark:text-lime-200/65">
                            {b.estimatorData.categoryLabel}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#052E16]/50 dark:text-lime-200/50">Custom Scope</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {hasPermission('bid_requests.write') ? (
                        <select
                          value={b.status}
                          onChange={(e) => void handleStatusChange(b.id, e.target.value as BidRequestStatus)}
                          aria-label={`Status for ${b.requestCode}`}
                          className="rounded-md border border-emerald-950/15 bg-[#F6FAF1] px-2 py-1 text-[11px] font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
                        >
                          {BID_REQUEST_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge value={b.status} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        {b.convertedWorkOrderId ? (
                          <Link
                            to={`/admin/work-orders/${b.convertedWorkOrderId}`}
                            className="inline-flex items-center gap-1 rounded-md bg-lime-200 px-2.5 py-1 text-[11px] font-bold text-[#052E16]"
                          >
                            View WO
                          </Link>
                        ) : (
                          hasPermission('bid_requests.convert') && (
                            <button
                              type="button"
                              onClick={() => void handleConvert(b.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-[#052E16] px-2.5 py-1 text-[11px] font-bold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                            >
                              Convert to WO
                            </button>
                          )
                        )}
                        <Link
                          to={`/admin/bid-requests/${b.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-emerald-950/5 dark:border-lime-300/20"
                        >
                          Details <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-emerald-950/10 px-4 py-3 text-xs dark:border-lime-300/15">
            <span>
              Page {page} of {totalPages} ({items.length} total)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-emerald-950/15 px-3 py-1 disabled:opacity-40 cursor-pointer"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-emerald-950/15 px-3 py-1 disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
