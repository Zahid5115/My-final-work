import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, Search, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import {
  VENDOR_APPLICATION_STATUSES,
  type VendorBidEntity,
  type VendorRecord
} from '../../types/platform';

export const VendorsPage: React.FC = () => {
  const { hasPermission } = useAdminAuth();
  const [tab, setTab] = useState<'vendors' | 'bids'>('vendors');
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [bids, setBids] = useState<VendorBidEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Create vendor form
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [coverageAreas, setCoverageAreas] = useState('');
  const [aspenGroveAbc, setAspenGroveAbc] = useState('');
  const [insuranceInfo, setInsuranceInfo] = useState('$2M GL / $1M E&O');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (search.trim()) params.set('q', search.trim());

      const [vRes, bRes] = await Promise.all([
        apiRequest<{ items: VendorRecord[] }>(`/api/admin/vendors?${params.toString()}`),
        hasPermission('vendor_bids.read')
          ? apiRequest<{ items: VendorBidEntity[] }>('/api/admin/vendor-bids').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] })
      ]);
      setVendors(vRes.items);
      setBids(bRes.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load vendors.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, hasPermission]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/vendors', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          contactPerson,
          email,
          phone,
          coverageAreas,
          aspenGroveAbc,
          insuranceInfo,
          serviceCategories: ['Property Preservation', 'Lawn Maintenance'],
          applicationStatus: 'Approved'
        })
      });
      setToast({ type: 'success', text: `Vendor ${companyName} added.` });
      setCreateOpen(false);
      setCompanyName('');
      setContactPerson('');
      setEmail('');
      setPhone('');
      await loadData();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Create vendor failed.' });
    }
  };

  const handleBidDecision = async (bidId: string, decision: 'accept' | 'reject' | 'clarify') => {
    try {
      await apiRequest(`/api/admin/vendor-bids/${bidId}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          clarificationNote: decision === 'clarify' ? 'Please confirm scope timeline and photo availability.' : ''
        })
      });
      setToast({
        type: 'success',
        text: decision === 'accept' ? 'Bid accepted and work order dispatched.' : `Bid updated (${decision}).`
      });
      await loadData();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Bid action failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Vendor Network &amp; Bid Review</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Approve contractor applications, monitor ABC# &amp; insurance docs, and award vendor bids.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('vendors')}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer ${
              tab === 'vendors'
                ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                : 'border bg-white dark:bg-[#072716]'
            }`}
          >
            Vendors ({vendors.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('bids')}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer ${
              tab === 'bids'
                ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                : 'border bg-white dark:bg-[#072716]'
            }`}
          >
            Vendor Bids ({bids.length})
          </button>
          {hasPermission('vendors.write') && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
            >
              <Plus className="h-4 w-4" /> Add Vendor
            </button>
          )}
        </div>
      </div>

      {tab === 'vendors' ? (
        <>
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-950/12 bg-white p-4 dark:border-lime-300/20 dark:bg-[#072716] md:grid-cols-12">
            <div className="relative md:col-span-8">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 opacity-50" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vendor name, code, contact, ABC#, states..."
                className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] py-2 pr-3 pl-9 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
              />
            </div>
            <div className="md:col-span-4">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
              >
                <option value="All">All Application Statuses</option>
                {VENDOR_APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-emerald-950/12 bg-white dark:border-lime-300/20 dark:bg-[#072716]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-emerald-950/12 text-[#052E16]/70 dark:border-lime-300/15 dark:text-lime-300/80">
                <tr>
                  <th className="px-4 py-3 font-semibold">Vendor #</th>
                  <th className="px-4 py-3 font-semibold">Company &amp; Contact</th>
                  <th className="px-4 py-3 font-semibold">Trades &amp; Coverage</th>
                  <th className="px-4 py-3 font-semibold">Compliance</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Completed</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center opacity-70">Loading vendors...</td>
                  </tr>
                ) : vendors.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center opacity-70">No vendors found.</td>
                  </tr>
                ) : (
                  vendors.map((v) => (
                    <tr key={v.id} className="hover:bg-lime-100/40 dark:hover:bg-white/5">
                      <td className="px-4 py-3.5 font-mono-tabular font-bold whitespace-nowrap">
                        <Link to={`/admin/vendors/${v.id}`} className="text-emerald-800 hover:underline dark:text-lime-300">
                          {v.vendorCode}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-bold">{v.companyName}</p>
                        <p className="opacity-75">{v.contactPerson} · {v.phone}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-medium">{v.coverageAreas || 'National'}</p>
                        <p className="opacity-70">{v.serviceCategories.join(', ')}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-mono-tabular">{v.aspenGroveAbc || 'No ABC#'}</p>
                        <p className="opacity-70">{v.insuranceInfo}</p>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusBadge value={v.applicationStatus} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono-tabular font-semibold">
                        {v.completedWorkOrders}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          to={`/admin/vendors/${v.id}`}
                          className="rounded border border-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-lime-100 dark:border-lime-300/20 dark:hover:bg-white/10"
                        >
                          Profile
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-emerald-950/12 bg-white dark:border-lime-300/20 dark:bg-[#072716]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-emerald-950/12 text-[#052E16]/70 dark:border-lime-300/15 dark:text-lime-300/80">
              <tr>
                <th className="px-4 py-3 font-semibold">Bid #</th>
                <th className="px-4 py-3 font-semibold">Work Order</th>
                <th className="px-4 py-3 font-semibold">Vendor</th>
                <th className="px-4 py-3 font-semibold">Proposed Price</th>
                <th className="px-4 py-3 font-semibold">ETA</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
              {bids.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center opacity-70">No vendor bids submitted yet.</td>
                </tr>
              ) : (
                bids.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3.5 font-mono-tabular font-bold">{b.bidCode}</td>
                    <td className="px-4 py-3.5 font-mono-tabular">
                      <Link to={`/admin/work-orders/${b.workOrderId}`} className="underline">
                        {b.workOrderCode}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-semibold">{b.vendorName}</p>
                      <p className="opacity-70">{b.aspenGroveAbc || 'Portal Bid'}</p>
                    </td>
                    <td className="px-4 py-3.5 font-mono-tabular font-bold">
                      ${b.proposedPrice.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5">{b.estimatedCompletionTime}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge value={b.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      {hasPermission('vendor_bids.decide') && (b.status === 'Submitted' || b.status === 'Under Review') ? (
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleBidDecision(b.id, 'accept')}
                            className="inline-flex items-center gap-1 rounded bg-[#052E16] px-2.5 py-1 text-[11px] font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                          >
                            <Check className="h-3 w-3" /> Accept &amp; Assign
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBidDecision(b.id, 'clarify')}
                            className="rounded border px-2 py-1 text-[11px] font-semibold cursor-pointer"
                          >
                            Clarify
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBidDecision(b.id, 'reject')}
                            className="rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700 cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="opacity-60">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-emerald-950/60" onClick={() => setCreateOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-display text-lg font-bold">Add Approved Vendor</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreateVendor} className="mt-4 space-y-3">
              <input required placeholder="Company / LLC Name *" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              <input required placeholder="Primary Contact Person *" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              <div className="grid grid-cols-2 gap-3">
                <input required type="email" placeholder="Dispatch Email *" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
                <input required type="tel" placeholder="Phone *" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              </div>
              <input placeholder="States / Coverage Areas (e.g. IN, OH, KY)" value={coverageAreas} onChange={(e) => setCoverageAreas(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Aspen Grove ABC#" value={aspenGroveAbc} onChange={(e) => setAspenGroveAbc(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
                <input placeholder="Insurance Coverage" value={insuranceInfo} onChange={(e) => setInsuranceInfo(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg border px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer">Create Vendor</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
