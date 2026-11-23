import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import type {
  BidRequestEntity,
  ClientPropertyRecord,
  ClientRecord,
  ContactMessageEntity,
  WorkOrderEntity
} from '../../types/platform';

interface ClientDetailResponse {
  item: ClientRecord;
  workOrders: WorkOrderEntity[];
  bidRequests: BidRequestEntity[];
  messages: ContactMessageEntity[];
  properties: ClientPropertyRecord[];
}

export const ClientDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAdminAuth();
  const [data, setData] = useState<ClientDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const [propAddress, setPropAddress] = useState('');
  const [propCity, setPropCity] = useState('');
  const [propState, setPropState] = useState('');

  const loadClient = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiRequest<ClientDetailResponse>(`/api/admin/clients/${id}`);
      setData(res);
      setCompanyName(res.item.companyName);
      setContactName(res.item.contactName);
      setPhone(res.item.phone);
      setAddress(res.item.address);
      setNotes(res.item.notes);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load client.' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadClient();
  }, [loadClient]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    try {
      await apiRequest(`/api/admin/clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ companyName, contactName, phone, address, notes })
      });
      setToast({ type: 'success', text: 'Client profile updated.' });
      await loadClient();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const handleAddProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !propAddress.trim()) return;
    try {
      await apiRequest(`/api/admin/clients/${id}/properties`, {
        method: 'POST',
        body: JSON.stringify({ address: propAddress, city: propCity, state: propState })
      });
      setPropAddress('');
      setPropCity('');
      setPropState('');
      setToast({ type: 'success', text: 'Property added to client portfolio.' });
      await loadClient();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add property.' });
    }
  };

  if (loading || !data) {
    return <div className="h-64 animate-pulse rounded-xl bg-white dark:bg-[#072716]" />;
  }

  const { item: client, workOrders, bidRequests, messages, properties } = data;

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
      <div>
        <Link to="/admin/clients" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:underline dark:text-lime-300">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Clients
        </Link>
        <div className="mt-1 flex items-center gap-2.5">
          <h2 className="font-display text-2xl font-bold">{client.companyName || client.contactName}</h2>
          <StatusBadge value={client.accountStatus} />
        </div>
        <p className="text-xs opacity-75">
          <span className="font-mono-tabular">{client.clientCode}</span> · {client.clientType} · {client.email}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form onSubmit={handleSave} className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-5 space-y-3">
          <h3 className="font-display text-lg font-bold">Client Profile</h3>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company Name" className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact Name" className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Account notes" className="w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
          {hasPermission('clients.write') && (
            <button type="submit" className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer">
              Save Client Changes
            </button>
          )}
        </form>

        <div className="space-y-5 lg:col-span-7">
          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
            <h3 className="font-display text-lg font-bold">Client Properties ({properties.length})</h3>
            {hasPermission('clients.write') && (
              <form onSubmit={handleAddProperty} className="mt-3 flex flex-wrap gap-2">
                <input required value={propAddress} onChange={(e) => setPropAddress(e.target.value)} placeholder="Street Address" className="flex-1 min-w-[180px] rounded-lg border px-3 py-1.5 text-xs dark:bg-[#041A0E]" />
                <input value={propCity} onChange={(e) => setPropCity(e.target.value)} placeholder="City" className="w-28 rounded-lg border px-3 py-1.5 text-xs dark:bg-[#041A0E]" />
                <input value={propState} onChange={(e) => setPropState(e.target.value)} placeholder="State" className="w-16 rounded-lg border px-2 py-1.5 text-xs dark:bg-[#041A0E]" />
                <button type="submit" className="inline-flex items-center gap-1 rounded-lg bg-[#052E16] px-3 py-1.5 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer">
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </form>
            )}
            <div className="mt-3 space-y-2 text-xs">
              {properties.map((p) => (
                <div key={p.id} className="rounded border p-2.5">
                  <p className="font-semibold">{p.address}, {p.city} {p.state}</p>
                  <p className="opacity-70">{p.occupancyStatus} {p.lockboxCode ? `· Lockbox: ${p.lockboxCode}` : ''}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
            <h3 className="font-display text-base font-bold">Work Orders ({workOrders.length}), Bid Requests ({bidRequests.length}) &amp; Messages ({messages.length})</h3>
            <div className="mt-3 space-y-2 text-xs">
              {workOrders.map((w) => (
                <Link key={w.id} to={`/admin/work-orders/${w.id}`} className="flex items-center justify-between rounded border p-2 hover:bg-lime-100/40 dark:hover:bg-white/5">
                  <span><strong className="font-mono-tabular">{w.workOrderCode}</strong> · {w.serviceDescription}</span>
                  <StatusBadge value={w.status} />
                </Link>
              ))}
              {bidRequests.map((b) => (
                <Link key={b.id} to={`/admin/bid-requests/${b.id}`} className="flex items-center justify-between rounded border p-2 hover:bg-lime-100/40 dark:hover:bg-white/5">
                  <span>Bid Request <strong className="font-mono-tabular">{b.requestCode}</strong> · {b.requestedServices}</span>
                  <StatusBadge value={b.status} />
                </Link>
              ))}
              {messages.map((m) => (
                <div key={m.id} className="rounded border p-2">
                  <p className="font-semibold">{m.subject}</p>
                  <p className="opacity-70">{m.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
