import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileText, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import type {
  ActivityLogEntity,
  VendorApplicationStatus,
  VendorBidEntity,
  VendorDocumentRecord,
  VendorRecord,
  WorkOrderEntity
} from '../../types/platform';

interface VendorDetailResponse {
  item: VendorRecord;
  workOrders: WorkOrderEntity[];
  bids: VendorBidEntity[];
  documents: VendorDocumentRecord[];
  activity: ActivityLogEntity[];
}

export const VendorDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAdminAuth();
  const [data, setData] = useState<VendorDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [coverageAreas, setCoverageAreas] = useState('');
  const [aspenGroveAbc, setAspenGroveAbc] = useState('');
  const [licenseInfo, setLicenseInfo] = useState('');
  const [insuranceInfo, setInsuranceInfo] = useState('');
  const [notes, setNotes] = useState('');

  const loadVendor = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiRequest<VendorDetailResponse>(`/api/admin/vendors/${id}`);
      setData(res);
      setCompanyName(res.item.companyName);
      setContactPerson(res.item.contactPerson);
      setPhone(res.item.phone);
      setCoverageAreas(res.item.coverageAreas);
      setAspenGroveAbc(res.item.aspenGroveAbc);
      setLicenseInfo(res.item.licenseInfo);
      setInsuranceInfo(res.item.insuranceInfo);
      setNotes(res.item.notes);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load vendor.' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadVendor();
  }, [loadVendor]);

  const handleStatusChange = async (applicationStatus: VendorApplicationStatus) => {
    if (!id) return;
    try {
      await apiRequest(`/api/admin/vendors/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ applicationStatus })
      });
      setToast({ type: 'success', text: `Vendor status changed to ${applicationStatus}.` });
      await loadVendor();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update status.' });
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    try {
      await apiRequest(`/api/admin/vendors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          companyName,
          contactPerson,
          phone,
          coverageAreas,
          aspenGroveAbc,
          licenseInfo,
          insuranceInfo,
          notes
        })
      });
      setToast({ type: 'success', text: 'Vendor profile saved.' });
      await loadVendor();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', 'Insurance / W-9 Compliance');
    try {
      await apiRequest(`/api/admin/vendors/${id}/documents`, { method: 'POST', body: formData });
      setToast({ type: 'success', text: `Uploaded ${file.name}.` });
      await loadVendor();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      e.target.value = '';
    }
  };

  if (loading || !data) {
    return <div className="h-64 animate-pulse rounded-xl bg-white dark:bg-[#072716]" />;
  }

  const { item: v, workOrders, bids, documents, activity } = data;

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/admin/vendors" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:underline dark:text-lime-300">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Vendors
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-2xl font-bold">{v.companyName}</h2>
            <StatusBadge value={v.applicationStatus} />
          </div>
          <p className="text-xs opacity-75">
            <span className="font-mono-tabular">{v.vendorCode}</span> · Registered {new Date(v.registrationDate).toLocaleDateString()}
          </p>
        </div>

        {hasPermission('vendors.approve') && (
          <div className="flex flex-wrap gap-2">
            {v.applicationStatus !== 'Approved' && (
              <button
                type="button"
                onClick={() => handleStatusChange('Approved')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-3.5 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" /> Approve Vendor
              </button>
            )}
            {v.applicationStatus === 'Pending' && (
              <button
                type="button"
                onClick={() => handleStatusChange('Rejected')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3.5 py-2 text-xs font-semibold text-red-700 cursor-pointer"
              >
                <XCircle className="h-4 w-4" /> Reject
              </button>
            )}
            {v.applicationStatus === 'Approved' && (
              <button
                type="button"
                onClick={() => handleStatusChange('Suspended')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3.5 py-2 text-xs font-semibold text-red-700 cursor-pointer"
              >
                <ShieldAlert className="h-4 w-4" /> Suspend Vendor
              </button>
            )}
            {v.applicationStatus === 'Suspended' && (
              <button
                type="button"
                onClick={() => handleStatusChange('Approved')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                Reactivate Vendor
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form onSubmit={handleSaveProfile} className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-6 space-y-3">
          <h3 className="font-display text-lg font-bold">Profile &amp; Coverage Settings</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold">Company Name</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
            <div>
              <label className="block text-xs font-semibold">Contact Person</label>
              <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
            <div>
              <label className="block text-xs font-semibold">Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
            <div>
              <label className="block text-xs font-semibold">Aspen Grove ABC#</label>
              <input value={aspenGroveAbc} onChange={(e) => setAspenGroveAbc(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold">Coverage Areas</label>
              <input value={coverageAreas} onChange={(e) => setCoverageAreas(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
            <div>
              <label className="block text-xs font-semibold">License Info</label>
              <input value={licenseInfo} onChange={(e) => setLicenseInfo(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
            <div>
              <label className="block text-xs font-semibold">Insurance Info</label>
              <input value={insuranceInfo} onChange={(e) => setInsuranceInfo(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold">Internal Vendor Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-xs dark:bg-[#041A0E]" />
            </div>
          </div>
          {hasPermission('vendors.write') && (
            <button type="submit" className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer">
              Save Vendor Profile
            </button>
          )}
        </form>

        <div className="space-y-6 lg:col-span-6">
          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold flex items-center gap-2">
                <FileText className="h-4 w-4" /> Compliance Documents
              </h3>
              {hasPermission('vendors.write') && (
                <label className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-3 py-1.5 text-xs font-semibold text-[#BEF264] cursor-pointer dark:bg-lime-400 dark:text-[#052E16]">
                  <Upload className="h-3.5 w-3.5" /> Upload Doc
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleUploadDoc} />
                </label>
              )}
            </div>
            <div className="mt-3 space-y-2 text-xs">
              {documents.length === 0 ? (
                <p className="opacity-65">No vendor compliance documents uploaded yet.</p>
              ) : (
                documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between border-b pb-2">
                    <span>{d.fileName} ({d.docType})</span>
                    <a href={`/api/admin/files/${d.storageBucket}/${d.storagePath}`} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                      View
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
            <h3 className="font-display text-lg font-bold">Work Orders ({workOrders.length}) &amp; Bids ({bids.length})</h3>
            <div className="mt-3 space-y-2 text-xs">
              {workOrders.map((w) => (
                <Link key={w.id} to={`/admin/work-orders/${w.id}`} className="flex items-center justify-between rounded border p-2 hover:bg-lime-100/40 dark:hover:bg-white/5">
                  <span><strong className="font-mono-tabular">{w.workOrderCode}</strong> · {w.city}, {w.state}</span>
                  <StatusBadge value={w.status} />
                </Link>
              ))}
              {bids.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded border p-2">
                  <span>Bid <strong className="font-mono-tabular">{b.bidCode}</strong> on {b.workOrderCode} · ${b.proposedPrice}</span>
                  <StatusBadge value={b.status} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-950/12 bg-white p-6 dark:border-lime-300/20 dark:bg-[#072716]">
            <h3 className="font-display text-base font-bold">Activity Timeline</h3>
            <div className="mt-3 space-y-2 text-xs">
              {activity.length === 0 ? (
                <p className="opacity-65">No activity entries yet.</p>
              ) : (
                activity.map((a) => (
                  <div key={a.id} className="border-l-2 border-emerald-800 pl-3 dark:border-lime-400">
                    <p className="font-semibold">{a.summary}</p>
                    <p className="opacity-65">{a.actorEmail} · {new Date(a.createdAt).toLocaleString()}</p>
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
