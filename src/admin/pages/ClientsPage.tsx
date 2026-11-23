import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Plus, Search, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { CLIENT_TYPES, type ClientRecord, type ClientType } from '../../types/platform';

export const ClientsPage: React.FC = () => {
  const { hasPermission } = useAdminAuth();
  const [items, setItems] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('active');
  const [createOpen, setCreateOpen] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [clientType, setClientType] = useState<ClientType>('Property Manager');
  const [address, setAddress] = useState('');

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (typeFilter !== 'All') params.set('clientType', typeFilter);
      if (search.trim()) params.set('q', search.trim());
      const res = await apiRequest<{ items: ClientRecord[] }>(`/api/admin/clients?${params.toString()}`);
      setItems(res.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load clients.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, search]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/clients', {
        method: 'POST',
        body: JSON.stringify({ companyName, contactName, email, phone, clientType, address })
      });
      setToast({ type: 'success', text: 'Client account created.' });
      setCreateOpen(false);
      setCompanyName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setAddress('');
      await loadClients();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create client.' });
    }
  };

  const handleToggleArchive = async (client: ClientRecord) => {
    const next = client.accountStatus === 'active' ? 'archived' : 'active';
    try {
      await apiRequest(`/api/admin/clients/${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ accountStatus: next })
      });
      setToast({ type: 'success', text: `Client ${next}.` });
      await loadClients();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Client &amp; Portfolio Management</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Manage mortgage servicers, REO asset managers, property managers, and homeowners.
          </p>
        </div>
        {hasPermission('clients.write') && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
          >
            <Plus className="h-4 w-4" /> New Client
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-950/12 bg-white p-4 dark:border-lime-300/20 dark:bg-[#072716] md:grid-cols-12">
        <div className="relative md:col-span-6">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client code, company, contact, email..."
            className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] py-2 pr-3 pl-9 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]"
          />
        </div>
        <div className="md:col-span-3">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]">
            <option value="All">All Client Types</option>
            {CLIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs dark:border-lime-300/20 dark:bg-[#041A0E]">
            <option value="active">Active Clients</option>
            <option value="archived">Archived Clients</option>
            <option value="All">All Statuses</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-emerald-950/12 bg-white dark:border-lime-300/20 dark:bg-[#072716]">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-emerald-950/12 text-[#052E16]/70 dark:border-lime-300/15 dark:text-lime-300/80">
            <tr>
              <th className="px-4 py-3 font-semibold">Client #</th>
              <th className="px-4 py-3 font-semibold">Company / Contact</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Email &amp; Phone</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center opacity-70">Loading clients...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center opacity-70">No clients match filters.</td></tr>
            ) : (
              items.map((c) => (
                <tr key={c.id} className="hover:bg-lime-100/40 dark:hover:bg-white/5">
                  <td className="px-4 py-3.5 font-mono-tabular font-bold">
                    <Link to={`/admin/clients/${c.id}`} className="text-emerald-800 hover:underline dark:text-lime-300">
                      {c.clientCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-bold">{c.companyName || c.contactName}</p>
                    <p className="opacity-70">{c.contactName}</p>
                  </td>
                  <td className="px-4 py-3.5">{c.clientType}</td>
                  <td className="px-4 py-3.5">
                    <p>{c.email}</p>
                    <p className="opacity-70">{c.phone}</p>
                  </td>
                  <td className="px-4 py-3.5"><StatusBadge value={c.accountStatus} /></td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex gap-2">
                      <Link to={`/admin/clients/${c.id}`} className="rounded border px-2.5 py-1 text-[11px] font-semibold">
                        Profile
                      </Link>
                      {hasPermission('clients.write') && (
                        <button
                          type="button"
                          onClick={() => handleToggleArchive(c)}
                          title={c.accountStatus === 'active' ? 'Archive client' : 'Restore client'}
                          className="rounded border px-2 py-1 text-[11px] font-semibold cursor-pointer"
                        >
                          <Archive className="h-3.5 w-3.5" />
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

      {createOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-emerald-950/60" onClick={() => setCreateOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-display text-lg font-bold">Add New Client</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <input placeholder="Company / Asset Manager Name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              <input required placeholder="Primary Contact Name *" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              <div className="grid grid-cols-2 gap-3">
                <input required type="email" placeholder="Email *" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
                <input required type="tel" placeholder="Phone *" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              </div>
              <select value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]">
                {CLIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="Billing / Office Address" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg border px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer">Create Client</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
