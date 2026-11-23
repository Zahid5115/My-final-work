import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import type { GalleryCaseEntity } from '../../types/platform';

export const GalleryAdminPage: React.FC = () => {
  const [items, setItems] = useState<GalleryCaseEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GalleryCaseEntity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GalleryCaseEntity | null>(null);
  const [uploading, setUploading] = useState<'before' | 'after' | null>(null);

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [scopeSummary, setScopeSummary] = useState('');
  const [turnaroundHours, setTurnaroundHours] = useState('36');
  const [beforeImage, setBeforeImage] = useState('');
  const [afterImage, setAfterImage] = useState('');
  const [isPublished, setIsPublished] = useState(true);

  const loadGallery = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ items: GalleryCaseEntity[] }>('/api/admin/gallery');
      setItems(res.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load gallery cases.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setLocation('');
    setWorkOrderId('WO-');
    setScopeSummary('');
    setTurnaroundHours('36');
    setBeforeImage('');
    setAfterImage('');
    setIsPublished(true);
    setModalOpen(true);
  };

  const openEdit = (item: GalleryCaseEntity) => {
    setEditing(item);
    setTitle(item.title);
    setLocation(item.location);
    setWorkOrderId(item.workOrderId);
    setScopeSummary(item.scopeSummary);
    setTurnaroundHours(String(item.turnaroundHours));
    setBeforeImage(item.beforeImage);
    setAfterImage(item.afterImage);
    setIsPublished(item.isPublished);
    setModalOpen(true);
  };

  const handleImageUpload = async (side: 'before' | 'after', file: File | undefined) => {
    if (!file) return;
    setUploading(side);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiRequest<{ url: string }>('/api/admin/gallery/upload', {
        method: 'POST',
        body: fd
      });
      if (side === 'before') setBeforeImage(res.url);
      else setAfterImage(res.url);
      setToast({ type: 'success', text: `${side === 'before' ? 'Before' : 'After'} photo uploaded.` });
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Photo upload failed.' });
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      title,
      location,
      workOrderId,
      scopeSummary,
      turnaroundHours: Number(turnaroundHours) || 36,
      beforeImage,
      afterImage,
      isPublished
    };
    try {
      if (editing) {
        await apiRequest(`/api/admin/gallery/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Updated gallery case "${title}".` });
      } else {
        await apiRequest('/api/admin/gallery', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Created gallery case "${title}".` });
      }
      setModalOpen(false);
      await loadGallery();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const togglePublish = async (item: GalleryCaseEntity) => {
    try {
      await apiRequest(`/api/admin/gallery/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: !item.isPublished })
      });
      await loadGallery();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/api/admin/gallery/${deleteTarget.id}`, { method: 'DELETE' });
      setToast({ type: 'success', text: `Deleted gallery case "${deleteTarget.title}".` });
      setDeleteTarget(null);
      await loadGallery();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Before &amp; After Gallery CMS</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Upload Before &amp; After field documentation photos and control public showcase publication.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-[#052E16] px-4 py-2.5 text-xs font-bold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Add Gallery Case
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs">Loading gallery cases...</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="overflow-hidden rounded-xl border border-emerald-950/12 bg-white shadow-xs dark:border-lime-300/15 dark:bg-[#072716]"
            >
              <div className="grid grid-cols-2 gap-1 bg-emerald-950/10">
                <div className="relative aspect-4/3">
                  <img src={item.beforeImage} alt={item.beforeAlt} className="h-full w-full object-cover" />
                  <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">
                    BEFORE
                  </span>
                </div>
                <div className="relative aspect-4/3">
                  <img src={item.afterImage} alt={item.afterAlt} className="h-full w-full object-cover" />
                  <span className="absolute top-2 left-2 rounded bg-[#BEF264] px-2 py-0.5 text-[10px] font-bold text-[#052E16]">
                    AFTER
                  </span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono-tabular text-[11px] font-bold text-emerald-800 dark:text-lime-300">
                      {item.workOrderId} · {item.location} · {item.turnaroundHours}h
                    </span>
                    <h3 className="mt-0.5 font-display text-base font-bold">{item.title}</h3>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      item.isPublished ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {item.isPublished ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[#052E16]/75 dark:text-lime-200/75">{item.scopeSummary}</p>
                <div className="mt-3 flex justify-end gap-1.5 border-t border-emerald-950/10 pt-3 dark:border-lime-300/15">
                  <button
                    type="button"
                    onClick={() => void togglePublish(item)}
                    className="rounded-md border border-emerald-950/15 p-1.5 hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                    title={item.isPublished ? 'Unpublish' : 'Publish'}
                  >
                    {item.isPublished ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="rounded-md border border-emerald-950/15 p-1.5 hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(item)}
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
            className="relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {editing ? 'Edit Before/After Case' : 'New Before/After Case'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block font-semibold">Case Title *</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Location *</label>
                <input
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Indianapolis, IN"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Work Order Reference</label>
                <input
                  value={workOrderId}
                  onChange={(e) => setWorkOrderId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Turnaround Hours</label>
                <input
                  type="number"
                  min={1}
                  value={turnaroundHours}
                  onChange={(e) => setTurnaroundHours(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">Scope Summary</label>
                <textarea
                  rows={2}
                  value={scopeSummary}
                  onChange={(e) => setScopeSummary(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>

              <div>
                <label className="block font-semibold">Before Image URL *</label>
                <input
                  required
                  value={beforeImage}
                  onChange={(e) => setBeforeImage(e.target.value)}
                  placeholder="Upload or paste /assets/ or https://"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
                <label className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-lime-100 cursor-pointer">
                  <Upload className="h-3 w-3" />
                  {uploading === 'before' ? 'Uploading...' : 'Upload Before Photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void handleImageUpload('before', e.target.files?.[0])}
                  />
                </label>
              </div>

              <div>
                <label className="block font-semibold">After Image URL *</label>
                <input
                  required
                  value={afterImage}
                  onChange={(e) => setAfterImage(e.target.value)}
                  placeholder="Upload or paste /assets/ or https://"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
                <label className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-lime-100 cursor-pointer">
                  <Upload className="h-3 w-3" />
                  {uploading === 'after' ? 'Uploading...' : 'Upload After Photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void handleImageUpload('after', e.target.files?.[0])}
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
                <span className="font-semibold">Publish on Public Before/After Showcase</span>
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
                Save Case
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Gallery Case"
        description={`Are you sure you want to delete "${deleteTarget?.title}"?`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
