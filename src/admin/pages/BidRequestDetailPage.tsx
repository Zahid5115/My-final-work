import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import {
  BID_REQUEST_STATUSES,
  PRIORITY_LEVELS,
  type ActivityLogEntity,
  type BidRequestEntity,
  type BidRequestStatus,
  type PriorityLevel
} from '../../types/platform';

export const BidRequestDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminAuth();

  const [item, setItem] = useState<BidRequestEntity | null>(null);
  const [activity, setActivity] = useState<ActivityLogEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [status, setStatus] = useState<BidRequestStatus>('New');
  const [internalNotes, setInternalNotes] = useState('');
  const [convertBudget, setConvertBudget] = useState('');
  const [convertPriority, setConvertPriority] = useState<PriorityLevel>('Normal');
  const [convertCounty, setConvertCounty] = useState('');
  const [saving, setSaving] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ item: BidRequestEntity; activity: ActivityLogEntity[] }>(
        `/api/admin/bid-requests/${id}`
      );
      setItem(res.item);
      setActivity(res.activity);
      setStatus(res.item.status);
      setInternalNotes(res.item.internalNotes || '');
      if (res.item.estimatorData) {
        const mid = Math.round((res.item.estimatorData.lowEstimate + res.item.estimatorData.highEstimate) / 2);
        setConvertBudget(String(mid));
      }
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load bid request.' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setSaving(true);
    try {
      await apiRequest(`/api/admin/bid-requests/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, internalNotes })
      });
      setToast({ type: 'success', text: 'Bid request updated.' });
      await loadDetail();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToWorkOrder = async () => {
    if (!item) return;
    setSaving(true);
    try {
      const res = await apiRequest<{ workOrder: { id: string; workOrderCode: string } }>(
        `/api/admin/bid-requests/${item.id}/convert`,
        {
          method: 'POST',
          body: JSON.stringify({
            estimatedBudget: Number(convertBudget) || undefined,
            priority: convertPriority,
            county: convertCounty
          })
        }
      );
      setToast({ type: 'success', text: `Converted to Work Order ${res.workOrder.workOrderCode}.` });
      navigate(`/admin/work-orders/${res.workOrder.id}`);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Conversion failed.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-xs">Loading bid request details...</div>;
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        <Link to="/admin/bid-requests" className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Bid Requests
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin/bid-requests"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-950/15 bg-white text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl font-bold">{item.requestCode}</h2>
              <StatusBadge value={item.status} />
            </div>
            <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
              Submitted {new Date(item.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {item.convertedWorkOrderId && (
          <Link
            to={`/admin/work-orders/${item.convertedWorkOrderId}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]"
          >
            <CheckCircle2 className="h-4 w-4" />
            Open Converted Work Order
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left Details */}
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
            <h3 className="font-display text-sm font-bold uppercase tracking-wide text-emerald-800 dark:text-lime-300">
              Customer &amp; Property Scope
            </h3>
            <dl className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-[#052E16]/60 dark:text-lime-200/60">Contact Name</dt>
                <dd className="mt-0.5 font-bold">{item.contactName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#052E16]/60 dark:text-lime-200/60">Email / Phone</dt>
                <dd className="mt-0.5">
                  {item.email} · {item.phone}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#052E16]/60 dark:text-lime-200/60">Property Address</dt>
                <dd className="mt-0.5 font-semibold">{item.propertyAddress}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#052E16]/60 dark:text-lime-200/60">Requested Service Scope</dt>
                <dd className="mt-0.5 font-semibold">{item.requestedServices}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-[#052E16]/60 dark:text-lime-200/60">Customer Notes</dt>
                <dd className="mt-1 rounded-lg bg-[#F6FAF1] p-3 text-xs dark:bg-[#03170C]">
                  {item.notes || 'No additional scope notes provided.'}
                </dd>
              </div>
            </dl>

            {item.estimatorData && (
              <div className="mt-4 rounded-xl border border-lime-400/50 bg-[#BEF264]/25 p-4 dark:bg-lime-400/10">
                <div className="flex items-center gap-2 text-xs font-bold text-[#052E16] dark:text-lime-200">
                  <FileSpreadsheet className="h-4 w-4" />
                  Attached Quote Estimator Calculation
                </div>
                <p className="mt-1 text-sm font-bold text-[#052E16] dark:text-lime-50">
                  {item.estimatorData.categoryLabel}: ${item.estimatorData.lowEstimate.toLocaleString()} – $
                  {item.estimatorData.highEstimate.toLocaleString()}
                </p>
                <p className="mt-0.5 text-xs text-[#052E16]/80 dark:text-lime-200/80">
                  {item.estimatorData.summary}
                </p>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSave}
            className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]"
          >
            <h3 className="font-display text-sm font-bold">Internal Evaluation &amp; Status</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold">Workflow Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as BidRequestStatus)}
                  disabled={!hasPermission('bid_requests.write')}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#03170C]"
                >
                  {BID_REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold">Internal Estimating Notes</label>
                <textarea
                  rows={4}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  disabled={!hasPermission('bid_requests.write')}
                  placeholder="Record site photos check, pricing assumptions, or client callback log..."
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              {hasPermission('bid_requests.write') && (
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Evaluation'}
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right Column: Convert + Activity */}
        <div className="space-y-5">
          {!item.convertedWorkOrderId && hasPermission('bid_requests.convert') && (
            <div className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
              <h3 className="font-display text-sm font-bold">Convert to Work Order</h3>
              <p className="mt-1 text-xs text-[#052E16]/70 dark:text-lime-200/75">
                Automatically matches or registers the client account and posts a new Open Bid work order.
              </p>
              <div className="mt-4 space-y-3 text-xs">
                <div>
                  <label className="block font-semibold">Initial Estimated Budget ($)</label>
                  <input
                    type="number"
                    min={0}
                    value={convertBudget}
                    onChange={(e) => setConvertBudget(e.target.value)}
                    placeholder="350"
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  />
                </div>
                <div>
                  <label className="block font-semibold">Priority</label>
                  <select
                    value={convertPriority}
                    onChange={(e) => setConvertPriority(e.target.value as PriorityLevel)}
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
                  <label className="block font-semibold">County (Optional)</label>
                  <input
                    type="text"
                    value={convertCounty}
                    onChange={(e) => setConvertCounty(e.target.value)}
                    placeholder="e.g. Marion County"
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleConvertToWorkOrder()}
                  disabled={saving}
                  className="w-full rounded-lg bg-[#052E16] px-4 py-2.5 text-xs font-bold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  Convert &amp; Open Work Order
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
            <h3 className="font-display text-sm font-bold">Audit History</h3>
            <div className="mt-3 space-y-3">
              {activity.length === 0 ? (
                <p className="text-xs text-[#052E16]/60 dark:text-lime-200/60">No activity events logged yet.</p>
              ) : (
                activity.map((a) => (
                  <div key={a.id} className="border-l-2 border-lime-500 pl-3 text-xs">
                    <p className="font-semibold">{a.summary}</p>
                    <p className="text-[10px] text-[#052E16]/60 dark:text-lime-200/60">
                      {a.actorEmail} · {new Date(a.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
