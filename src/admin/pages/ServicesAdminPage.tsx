import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import type { ManagedServiceEntity } from '../../types/platform';

export const ServicesAdminPage: React.FC = () => {
  const [items, setItems] = useState<ManagedServiceEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [editing, setEditing] = useState<ManagedServiceEntity | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedServiceEntity | null>(null);

  // Form state
  const [serviceNumber, setServiceNumber] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [category, setCategory] = useState('');
  const [pricingModel, setPricingModel] = useState('Per Work Order');
  const [basePrice, setBasePrice] = useState('185');
  const [turnaround, setTurnaround] = useState('48 hr SLA');
  const [complianceNote, setComplianceNote] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [isVisible, setIsVisible] = useState(true);

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ items: ManagedServiceEntity[] }>('/api/admin/services');
      setItems(res.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load services.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const openCreate = () => {
    setEditing(null);
    setServiceNumber(`${String(items.length + 1).padStart(2, '0')}.`);
    setTitle('');
    setSubtitle('');
    setCategory('Property Preservation');
    setPricingModel('Per Work Order');
    setBasePrice('185');
    setTurnaround('48 hr SLA');
    setComplianceNote('HUD/FHA Photo-Verified');
    setItemsText('');
    setIsVisible(true);
    setModalOpen(true);
  };

  const openEdit = (svc: ManagedServiceEntity) => {
    setEditing(svc);
    setServiceNumber(svc.serviceNumber);
    setTitle(svc.title);
    setSubtitle(svc.subtitle);
    setCategory(svc.category);
    setPricingModel(svc.pricingModel);
    setBasePrice(String(svc.basePrice));
    setTurnaround(svc.turnaround);
    setComplianceNote(svc.complianceNote);
    setItemsText(svc.items.join('\n'));
    setIsVisible(svc.isVisible);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      serviceNumber,
      title,
      subtitle,
      category: category || title,
      pricingModel,
      basePrice: Number(basePrice) || 0,
      turnaround,
      complianceNote,
      items: itemsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      isVisible
    };
    try {
      if (editing) {
        await apiRequest(`/api/admin/services/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Service "${title}" updated.` });
      } else {
        await apiRequest('/api/admin/services', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Service "${title}" added.` });
      }
      setModalOpen(false);
      await loadServices();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const toggleVisibility = async (svc: ManagedServiceEntity) => {
    try {
      await apiRequest(`/api/admin/services/${svc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isVisible: !svc.isVisible })
      });
      await loadServices();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Toggle failed.' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/api/admin/services/${deleteTarget.id}`, { method: 'DELETE' });
      setToast({ type: 'success', text: `Deleted service "${deleteTarget.title}".` });
      setDeleteTarget(null);
      await loadServices();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Services Catalog CMS</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Changes sync directly to the public Services section and Work Order scope selector.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-[#052E16] px-4 py-2.5 text-xs font-bold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Add Service Division
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs">Loading services...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((svc) => (
            <div
              key={svc.id}
              className="flex flex-col justify-between rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono-tabular text-xs font-bold text-emerald-800 dark:text-lime-300">
                      {svc.serviceNumber} · {svc.pricingModel} · ${svc.basePrice}
                    </span>
                    <h3 className="mt-1 font-display text-lg font-bold">{svc.title}</h3>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                      svc.isVisible
                        ? 'bg-emerald-100 text-emerald-900 dark:bg-lime-400/20 dark:text-lime-300'
                        : 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-lime-100/60'
                    }`}
                  >
                    {svc.isVisible ? 'Public' : 'Hidden'}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[#052E16]/80 dark:text-lime-100/80">{svc.subtitle}</p>
                <ul className="mt-3 space-y-1 text-xs text-[#052E16]/80 dark:text-lime-200/80">
                  {svc.items.map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-950/10 pt-3 dark:border-lime-300/15">
                <span className="text-[11px] font-semibold text-emerald-800 dark:text-lime-300">
                  {svc.turnaround} · {svc.complianceNote}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void toggleVisibility(svc)}
                    title={svc.isVisible ? 'Hide from public site' : 'Show on public site'}
                    className="rounded-md border border-emerald-950/15 p-1.5 hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                  >
                    {svc.isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(svc)}
                    className="rounded-md border border-emerald-950/15 p-1.5 hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(svc)}
                    className="rounded-md border border-red-200 p-1.5 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-emerald-950/60" onClick={() => setModalOpen(false)} />
          <form
            onSubmit={handleSubmit}
            className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">{editing ? 'Edit Service' : 'New Service Division'}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div>
                <label className="block font-semibold">Number Badge</label>
                <input
                  value={serviceNumber}
                  onChange={(e) => setServiceNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Turnaround SLA</label>
                <input
                  value={turnaround}
                  onChange={(e) => setTurnaround(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">Title *</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">Description *</label>
                <textarea
                  required
                  rows={2}
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Pricing Model</label>
                <input
                  value={pricingModel}
                  onChange={(e) => setPricingModel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Base Price ($)</label>
                <input
                  type="number"
                  min={0}
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">Compliance Note</label>
                <input
                  value={complianceNote}
                  onChange={(e) => setComplianceNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">Scope Line Items (one per line)</label>
                <textarea
                  rows={4}
                  value={itemsText}
                  onChange={(e) => setItemsText(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" checked={isVisible} onChange={(e) => setIsVisible(e.target.checked)} />
                <span className="font-semibold">Publish on Public Website</span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-emerald-950/15 px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
              >
                Save Service
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Service Division"
        description={`Are you sure you want to permanently remove "${deleteTarget?.title}"?`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
