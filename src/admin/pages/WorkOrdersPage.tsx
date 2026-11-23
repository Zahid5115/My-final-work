import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import {
  CLIENT_TYPES,
  PRIORITY_LEVELS,
  WORK_ORDER_STATUSES,
  type ClientRecord,
  type ClientType,
  type PriorityLevel,
  type VendorRecord,
  type WorkOrderEntity
} from '../../types/platform';

const PAGE_SIZE = 10;

export const WorkOrdersPage: React.FC = () => {
  const { hasPermission } = useAdminAuth();
  const [items, setItems] = useState<WorkOrderEntity[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrderEntity | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Create form state
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientType, setClientType] = useState<ClientType>('Property Manager');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [county, setCounty] = useState('');
  const [serviceCategory, setServiceCategory] = useState('Property Preservation & Securing');
  const [serviceDescription, setServiceDescription] = useState('');
  const [priority, setPriority] = useState<PriorityLevel>('Normal');
  const [estimatedBudget, setEstimatedBudget] = useState('450');
  const [assignedVendorId, setAssignedVendorId] = useState('');
  const [slaDeadline, setSlaDeadline] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (priorityFilter !== 'All') params.set('priority', priorityFilter);
      if (search.trim()) params.set('q', search.trim());

      const [woRes, cliRes, vndRes] = await Promise.all([
        apiRequest<{ items: WorkOrderEntity[] }>(`/api/admin/work-orders?${params.toString()}`),
        hasPermission('clients.read')
          ? apiRequest<{ items: ClientRecord[] }>('/api/admin/clients').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        hasPermission('vendors.read')
          ? apiRequest<{ items: VendorRecord[] }>('/api/admin/vendors').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] })
      ]);
      setItems(woRes.items);
      setClients(cliRes.items);
      setVendors(vndRes.items.filter((v) => v.applicationStatus === 'Approved'));
      setPage(1);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load work orders.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, search, hasPermission]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ item: WorkOrderEntity }>('/api/admin/work-orders', {
        method: 'POST',
        body: JSON.stringify({
          clientId: clientId || null,
          clientName,
          clientType,
          propertyAddress,
          city,
          state: stateCode,
          zipCode,
          county,
          serviceCategory,
          serviceDescription,
          priority,
          estimatedBudget: Number(estimatedBudget) || 0,
          assignedVendorId: assignedVendorId || null,
          slaDeadline: slaDeadline ? new Date(slaDeadline).toISOString() : null
        })
      });
      setToast({ type: 'success', text: `Work Order ${res.item.workOrderCode} created.` });
      setCreateOpen(false);
      setPropertyAddress('');
      setCity('');
      setStateCode('');
      setServiceDescription('');
      await loadData();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create work order.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/admin/work-orders/${deleteTarget.id}`, { method: 'DELETE' });
      setToast({ type: 'success', text: `Work order ${deleteTarget.workOrderCode} deleted.` });
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csv = await apiRequest<string>('/api/admin/reports/export?type=work-orders');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'work-orders-export.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Export failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {/* Header & Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Work Order Management</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Create, dispatch, audit GPS completion photos, and manage HUD SLAs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasPermission('reports.export') && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-950/15 bg-white px-3.5 py-2 text-xs font-semibold text-[#052E16] hover:bg-lime-100 dark:border-lime-300/25 dark:bg-[#072716] dark:text-lime-100 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          )}
          {hasPermission('work_orders.write') && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Work Order
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-950/12 bg-white p-4 dark:border-lime-300/20 dark:bg-[#072716] md:grid-cols-12">
        <div className="relative md:col-span-6">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search WO#, property address, client, city, vendor..."
            className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] py-2 pr-3 pl-9 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
          />
        </div>
        <div className="md:col-span-3">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
          >
            <option value="All">All Statuses</option>
            {WORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-3">
          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
          >
            <option value="All">All Priorities</option>
            {PRIORITY_LEVELS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-emerald-950/12 bg-white dark:border-lime-300/20 dark:bg-[#072716]">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-emerald-950/12 text-[#052E16]/70 dark:border-lime-300/15 dark:text-lime-300/80">
            <tr>
              <th className="px-4 py-3 font-semibold">WO #</th>
              <th className="px-4 py-3 font-semibold">Property &amp; Scope</th>
              <th className="px-4 py-3 font-semibold">Client</th>
              <th className="px-4 py-3 font-semibold">Assigned Vendor</th>
              <th className="px-4 py-3 font-semibold">Priority</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Budget</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center opacity-70">Loading work orders...</td>
              </tr>
            ) : pagedItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center opacity-70">No work orders match the active filters.</td>
              </tr>
            ) : (
              pagedItems.map((wo) => (
                <tr key={wo.id} className="hover:bg-lime-100/40 dark:hover:bg-white/5">
                  <td className="px-4 py-3.5 font-mono-tabular font-bold whitespace-nowrap">
                    <Link to={`/admin/work-orders/${wo.id}`} className="text-emerald-800 hover:underline dark:text-lime-300">
                      {wo.workOrderCode}
                    </Link>
                    {wo.isDemo && (
                      <span className="ml-1.5 rounded bg-emerald-950/10 px-1.5 py-0.5 text-[9px] font-semibold dark:bg-white/10">
                        DEMO
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 min-w-[220px]">
                    <p className="font-semibold">{wo.serviceDescription}</p>
                    <p className="mt-0.5 opacity-75">
                      {wo.propertyAddress}, {wo.city}, {wo.state}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <p className="font-semibold">{wo.clientName}</p>
                    <p className="opacity-70">{wo.clientType}</p>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {wo.assignedVendorName || <span className="opacity-50">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <StatusBadge value={wo.priority} />
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <StatusBadge value={wo.status} />
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono-tabular font-semibold whitespace-nowrap">
                    ${(wo.approvedBudget ?? wo.estimatedBudget).toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        to={`/admin/work-orders/${wo.id}`}
                        className="rounded border border-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-lime-100 dark:border-lime-300/20 dark:hover:bg-white/10"
                      >
                        Manage
                      </Link>
                      {hasPermission('work_orders.delete') && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(wo)}
                          aria-label={`Delete work order ${wo.workOrderCode}`}
                          className="rounded p-1 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span>
            Page {page} of {totalPages} ({items.length} total)
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border px-3 py-1 font-semibold disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border px-3 py-1 font-semibold disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Create Work Order Modal */}
      {createOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-emerald-950/60" onClick={() => setCreateOpen(false)} />
          <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]">
            <div className="flex items-center justify-between border-b border-emerald-950/10 pb-3 dark:border-lime-300/15">
              <h3 className="font-display text-lg font-bold">Create New Work Order</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="p-1 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold">Link Existing Client</label>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                >
                  <option value="">-- Direct / Custom Client --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName || c.contactName} ({c.clientCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold">Client Type</label>
                <select
                  value={clientType}
                  onChange={(e) => setClientType(e.target.value as ClientType)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                >
                  {CLIENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </div>
              {!clientId && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold">Client / Portfolio Name</label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Heartland Mortgage Servicing"
                    className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold">Property Street Address *</label>
                <input
                  type="text"
                  required
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  placeholder="4120 N Meridian St"
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">City *</label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold">State *</label>
                  <input
                    type="text"
                    required
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value)}
                    placeholder="IN"
                    className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-2 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">ZIP</label>
                  <input
                    type="text"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-2 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">County</label>
                  <input
                    type="text"
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-2 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold">Service Category *</label>
                <select
                  value={serviceCategory}
                  onChange={(e) => setServiceCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                >
                  <option>Property Preservation &amp; Securing</option>
                  <option>Lawn Care &amp; Grounds Maintenance</option>
                  <option>Handyman &amp; REO Turnkey Repairs</option>
                  <option>Inspections &amp; Emergency Storm Assessment</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                >
                  {PRIORITY_LEVELS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold">Estimated Budget ($)</label>
                <input
                  type="number"
                  min={0}
                  value={estimatedBudget}
                  onChange={(e) => setEstimatedBudget(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 font-mono-tabular text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">Assign Approved Vendor</label>
                <select
                  value={assignedVendorId}
                  onChange={(e) => setAssignedVendorId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                >
                  <option value="">-- Leave Unassigned (Open Bid) --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.companyName}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold">SLA Deadline</label>
                <input
                  type="datetime-local"
                  value={slaDeadline}
                  onChange={(e) => setSlaDeadline(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold">Scope Description *</label>
                <textarea
                  rows={3}
                  required
                  value={serviceDescription}
                  onChange={(e) => setServiceDescription(e.target.value)}
                  placeholder="Initial grass cut, lock change, 10 cu yd debris trash-out..."
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
                />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#052E16] px-5 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  {submitting ? 'Creating...' : 'Create Work Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Work Order"
        description={`Are you sure you want to permanently delete ${deleteTarget?.workOrderCode}? This action cannot be undone.`}
        confirmLabel="Delete Work Order"
        destructive
        loading={submitting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
