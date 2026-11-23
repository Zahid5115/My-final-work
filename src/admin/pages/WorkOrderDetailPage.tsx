import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  History,
  MessageSquare,
  Upload,
  UserCheck,
  XCircle
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import {
  PRIORITY_LEVELS,
  WORK_ORDER_STATUSES,
  type ActivityLogEntity,
  type ClientRecord,
  type PriorityLevel,
  type VendorBidEntity,
  type VendorRecord,
  type WorkOrderAttachment,
  type WorkOrderEntity,
  type WorkOrderNote,
  type WorkOrderStatus,
  type WorkOrderTimelineEvent
} from '../../types/platform';

type DetailTab =
  | 'overview'
  | 'client'
  | 'vendor'
  | 'timeline'
  | 'photos'
  | 'documents'
  | 'notes'
  | 'activity';

interface WorkOrderDetailResponse {
  item: WorkOrderEntity;
  client: ClientRecord | null;
  vendor: VendorRecord | null;
  notes: WorkOrderNote[];
  attachments: WorkOrderAttachment[];
  timeline: WorkOrderTimelineEvent[];
  bids: VendorBidEntity[];
  activity: ActivityLogEntity[];
}

export const WorkOrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAdminAuth();
  const [tab, setTab] = useState<DetailTab>('overview');
  const [data, setData] = useState<WorkOrderDetailResponse | null>(null);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [statusVal, setStatusVal] = useState<WorkOrderStatus>('New');
  const [priorityVal, setPriorityVal] = useState<PriorityLevel>('Normal');
  const [approvedBudget, setApprovedBudget] = useState('');
  const [assignedVendorId, setAssignedVendorId] = useState('');
  const [qcNotes, setQcNotes] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteInternal, setNoteInternal] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [res, vndRes] = await Promise.all([
        apiRequest<WorkOrderDetailResponse>(`/api/admin/work-orders/${id}`),
        hasPermission('vendors.read')
          ? apiRequest<{ items: VendorRecord[] }>('/api/admin/vendors').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] })
      ]);
      setData(res);
      setStatusVal(res.item.status);
      setPriorityVal(res.item.priority);
      setApprovedBudget(res.item.approvedBudget != null ? String(res.item.approvedBudget) : '');
      setAssignedVendorId(res.item.assignedVendorId ?? '');
      setQcNotes(res.item.qcNotes ?? '');
      setVendors(vndRes.items.filter((v) => v.applicationStatus === 'Approved'));
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load work order.' });
    } finally {
      setLoading(false);
    }
  }, [id, hasPermission]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleSaveOverview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    try {
      await apiRequest(`/api/admin/work-orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: statusVal,
          priority: priorityVal,
          approvedBudget: approvedBudget ? Number(approvedBudget) : null,
          assignedVendorId: assignedVendorId || null
        })
      });
      setToast({ type: 'success', text: 'Work order updated.' });
      await loadDetail();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  const handleQcDecision = async (decision: 'approve' | 'reject') => {
    if (!id) return;
    try {
      await apiRequest(`/api/admin/work-orders/${id}/qc`, {
        method: 'POST',
        body: JSON.stringify({ decision, qcNotes })
      });
      setToast({
        type: 'success',
        text: decision === 'approve' ? 'Work order QC verified.' : 'Work order marked QC Rejected.'
      });
      await loadDetail();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'QC update failed.' });
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !noteBody.trim()) return;
    try {
      await apiRequest(`/api/admin/work-orders/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: noteBody, isInternal: noteInternal })
      });
      setNoteBody('');
      setToast({ type: 'success', text: 'Note recorded.' });
      await loadDetail();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add note.' });
    }
  };

  const handleUploadAttachment = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'before_photo' | 'after_photo' | 'document'
  ) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', kind);
      await apiRequest(`/api/admin/work-orders/${id}/attachments`, {
        method: 'POST',
        body: formData
      });
      setToast({ type: 'success', text: `Uploaded ${file.name}.` });
      await loadDetail();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Link to="/admin/work-orders" className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <ArrowLeft className="h-4 w-4" /> Back to Work Orders
        </Link>
        <div className="h-64 animate-pulse rounded-xl bg-white dark:bg-[#072716]" />
      </div>
    );
  }

  const { item: wo, client, vendor, notes, attachments, timeline, bids, activity } = data;
  const photos = attachments.filter((a) => a.kind === 'before_photo' || a.kind === 'after_photo');
  const docs = attachments.filter((a) => a.kind === 'document');

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: 'Overview & QC' },
    { id: 'client', label: 'Client Information' },
    { id: 'vendor', label: `Vendor & Bids (${bids.length})` },
    { id: 'timeline', label: `Timeline (${timeline.length})` },
    { id: 'photos', label: `Photos (${photos.length})` },
    { id: 'documents', label: `Documents (${docs.length})` },
    { id: 'notes', label: `Notes (${notes.length})` },
    { id: 'activity', label: `Activity History (${activity.length})` }
  ];

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/admin/work-orders" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:underline dark:text-lime-300">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Work Orders
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-2xl font-bold font-mono-tabular">{wo.workOrderCode}</h2>
            <StatusBadge value={wo.status} />
            <StatusBadge value={wo.priority} />
          </div>
          <p className="mt-1 text-xs text-[#052E16]/75 dark:text-lime-200/75">
            {wo.serviceCategory} · {wo.propertyAddress}, {wo.city}, {wo.state} {wo.zipCode}
          </p>
        </div>

        {hasPermission('work_orders.qc') && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleQcDecision('approve')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-3.5 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" /> Approve QC
            </button>
            <button
              type="button"
              onClick={() => handleQcDecision('reject')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200 cursor-pointer"
            >
              <XCircle className="h-4 w-4" /> Reject QC
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-emerald-950/12 pb-3 dark:border-lime-300/15">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              tab === t.id
                ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                : 'border border-emerald-950/15 bg-white text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-7 space-y-4">
            <h3 className="font-display text-lg font-bold">Scope &amp; Property Details</h3>
            <p className="text-sm leading-relaxed">{wo.serviceDescription}</p>
            <dl className="grid grid-cols-2 gap-4 border-t border-emerald-950/10 pt-4 text-xs dark:border-lime-300/15">
              <div>
                <dt className="opacity-70">County / Location</dt>
                <dd className="mt-0.5 font-semibold">{wo.county || 'N/A'} Co. · {wo.city}, {wo.state}</dd>
              </div>
              <div>
                <dt className="opacity-70">Coordinates</dt>
                <dd className="mt-0.5 font-mono-tabular font-semibold">
                  {wo.lat != null && wo.lng != null ? `${wo.lat.toFixed(4)}, ${wo.lng.toFixed(4)}` : 'Not geocoded'}
                </dd>
              </div>
              <div>
                <dt className="opacity-70">Estimated Budget</dt>
                <dd className="mt-0.5 font-mono-tabular font-bold">${wo.estimatedBudget.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="opacity-70">SLA Deadline</dt>
                <dd className="mt-0.5 font-mono-tabular font-semibold">
                  {wo.slaDeadline ? new Date(wo.slaDeadline).toLocaleString() : 'Standard 48h'}
                </dd>
              </div>
            </dl>
          </div>

          <form
            onSubmit={handleSaveOverview}
            className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-5 space-y-4"
          >
            <h3 className="font-display text-lg font-bold">Dispatch &amp; Status Controls</h3>
            <div>
              <label className="block text-xs font-semibold">Workflow Status</label>
              <select
                value={statusVal}
                onChange={(e) => setStatusVal(e.target.value as WorkOrderStatus)}
                className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              >
                {WORK_ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold">Priority Level</label>
              <select
                value={priorityVal}
                onChange={(e) => setPriorityVal(e.target.value as PriorityLevel)}
                className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              >
                {PRIORITY_LEVELS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold">Assigned Vendor</label>
              <select
                value={assignedVendorId}
                onChange={(e) => setAssignedVendorId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              >
                <option value="">-- Unassigned --</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.companyName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold">Approved Budget ($)</label>
              <input
                type="number"
                value={approvedBudget}
                onChange={(e) => setApprovedBudget(e.target.value)}
                className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 font-mono-tabular text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold">QC Review Notes</label>
              <textarea
                rows={2}
                value={qcNotes}
                onChange={(e) => setQcNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              />
            </div>
            {hasPermission('work_orders.write') && (
              <button
                type="submit"
                className="w-full rounded-lg bg-[#052E16] px-4 py-2.5 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
              >
                Save Work Order Changes
              </button>
            )}
          </form>
        </div>
      )}

      {tab === 'client' && (
        <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
          <h3 className="font-display text-lg font-bold">Client Information</h3>
          {client ? (
            <div className="mt-4 space-y-2 text-sm">
              <p><strong>Company:</strong> {client.companyName || 'Individual'}</p>
              <p><strong>Contact:</strong> {client.contactName}</p>
              <p><strong>Email:</strong> {client.email}</p>
              <p><strong>Phone:</strong> {client.phone}</p>
              <p><strong>Client Type:</strong> {client.clientType}</p>
              <Link to={`/admin/clients/${client.id}`} className="mt-3 inline-block text-xs font-semibold text-emerald-800 underline dark:text-lime-300">
                Open Client Profile &rarr;
              </Link>
            </div>
          ) : (
            <div className="mt-4 space-y-1 text-sm">
              <p><strong>Client Label:</strong> {wo.clientName}</p>
              <p><strong>Type:</strong> {wo.clientType}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'vendor' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-emerald-800 dark:text-lime-300" />
              <h3 className="font-display text-lg font-bold">Assigned Field Vendor</h3>
            </div>
            {vendor ? (
              <div className="mt-3 space-y-1.5 text-xs">
                <p className="text-sm font-bold">{vendor.companyName} ({vendor.vendorCode})</p>
                <p>Contact: {vendor.contactPerson} · {vendor.phone} · {vendor.email}</p>
                <p>Aspen Grove ABC#: {vendor.aspenGroveAbc || 'N/A'} · Insurance: {vendor.insuranceInfo}</p>
                <Link to={`/admin/vendors/${vendor.id}`} className="inline-block pt-2 font-semibold text-emerald-800 underline dark:text-lime-300">
                  Open Vendor Profile &rarr;
                </Link>
              </div>
            ) : (
              <p className="mt-2 text-xs opacity-70">No vendor assigned yet. Assign one in Overview or accept a vendor bid below.</p>
            )}
          </div>

          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
            <h3 className="font-display text-lg font-bold">Associated Vendor Bids</h3>
            {bids.length === 0 ? (
              <p className="mt-3 text-xs opacity-70">No vendor bids submitted on this work order.</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {bids.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs">
                    <div>
                      <p className="font-bold">{b.vendorName} · <span className="font-mono-tabular">{b.bidCode}</span></p>
                      <p className="opacity-75">${b.proposedPrice.toLocaleString()} · {b.estimatedCompletionTime} · {b.bidNotes}</p>
                    </div>
                    <StatusBadge value={b.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Work Order Timeline
          </h3>
          <div className="mt-4 space-y-3">
            {timeline.map((ev) => (
              <div key={ev.id} className="border-l-2 border-emerald-800 pl-3 text-xs dark:border-lime-400">
                <p className="font-semibold">{ev.description}</p>
                <p className="mt-0.5 opacity-65">{ev.actorName} · {new Date(ev.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'photos' && (
        <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-lg font-bold flex items-center gap-2">
              <Camera className="h-4 w-4" /> Before &amp; After Inspection Photos
            </h3>
            {hasPermission('work_orders.write') && (
              <div className="flex gap-2">
                <label className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-lime-100 dark:hover:bg-white/10">
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? 'Uploading...' : 'Upload Before Photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleUploadAttachment(e, 'before_photo')} />
                </label>
                <label className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-3 py-1.5 text-xs font-semibold text-[#BEF264] cursor-pointer dark:bg-lime-400 dark:text-[#052E16]">
                  <Upload className="h-3.5 w-3.5" />
                  Upload After Photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleUploadAttachment(e, 'after_photo')} />
                </label>
              </div>
            )}
          </div>
          {photos.length === 0 ? (
            <p className="py-8 text-center text-xs opacity-65">No photos uploaded for this work order yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((p) => (
                <div key={p.id} className="overflow-hidden rounded-xl border border-emerald-950/12 dark:border-lime-300/20">
                  <img
                    src={`/api/admin/files/${p.storageBucket}/${p.storagePath}`}
                    alt={p.fileName}
                    className="h-44 w-full object-cover"
                  />
                  <div className="p-3 text-xs">
                    <StatusBadge value={p.kind === 'before_photo' ? 'Before' : 'After'} />
                    <p className="mt-1 truncate font-semibold">{p.fileName}</p>
                    <p className="opacity-65">{p.uploadedBy}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold flex items-center gap-2">
              <FileText className="h-4 w-4" /> Work Order Documents
            </h3>
            {hasPermission('work_orders.write') && (
              <label className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-3.5 py-2 text-xs font-semibold text-[#BEF264] cursor-pointer dark:bg-lime-400 dark:text-[#052E16]">
                <Upload className="h-3.5 w-3.5" /> Upload Document
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" className="hidden" onChange={(e) => handleUploadAttachment(e, 'document')} />
              </label>
            )}
          </div>
          {docs.length === 0 ? (
            <p className="py-6 text-xs opacity-65">No documents attached yet.</p>
          ) : (
            <div className="divide-y">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold">{d.fileName}</p>
                    <p className="opacity-65">{Math.round(d.fileSize / 1024)} KB · Uploaded by {d.uploadedBy}</p>
                  </div>
                  <a
                    href={`/api/admin/files/${d.storageBucket}/${d.storagePath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-emerald-800 underline dark:text-lime-300"
                  >
                    Open File
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716] space-y-4">
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Notes &amp; Internal Memos
          </h3>
          {hasPermission('work_orders.write') && (
            <form onSubmit={handleAddNote} className="space-y-2.5">
              <textarea
                rows={3}
                required
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add dispatch update, lockbox code confirmation, or QC note..."
                className="w-full rounded-lg border border-emerald-950/20 bg-[#F6FAF1] p-3 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={noteInternal} onChange={(e) => setNoteInternal(e.target.checked)} />
                  Internal Admin Only
                </label>
                <button
                  type="submit"
                  className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  Save Note
                </button>
              </div>
            </form>
          )}
          <div className="space-y-2.5 pt-2">
            {notes.map((n) => (
              <div key={n.id} className="rounded-lg border border-emerald-950/10 p-3 text-xs dark:border-lime-300/15">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{n.authorName}</span>
                  <span className="opacity-65">
                    {n.isInternal ? 'Internal' : 'Shared'} · {new Date(n.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1.5">{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <History className="h-4 w-4" /> Immutable Audit Activity
          </h3>
          <div className="mt-4 space-y-2.5">
            {activity.length === 0 ? (
              <p className="text-xs opacity-65">No audit entries logged yet.</p>
            ) : (
              activity.map((a) => (
                <div key={a.id} className="rounded-lg border border-emerald-950/10 p-3 text-xs dark:border-lime-300/15">
                  <p className="font-semibold">{a.summary}</p>
                  <p className="mt-0.5 opacity-65">
                    {a.actorEmail} ({a.actorRole}) · {new Date(a.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
