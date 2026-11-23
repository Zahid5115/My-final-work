import React, { useCallback, useEffect, useState } from 'react';
import { Check, EyeOff, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import type { ReviewEntity, ReviewPublicationStatus } from '../../types/platform';

export const ReviewsAdminPage: React.FC = () => {
  const [items, setItems] = useState<ReviewEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReviewEntity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReviewEntity | null>(null);

  const [reviewer, setReviewer] = useState('');
  const [organization, setOrganization] = useState('');
  const [role, setRole] = useState('');
  const [rating, setRating] = useState('5');
  const [serviceTag, setServiceTag] = useState('');
  const [dateLabel, setDateLabel] = useState('Recently');
  const [comment, setComment] = useState('');
  const [publicationStatus, setPublicationStatus] = useState<ReviewPublicationStatus>('Published');

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ items: ReviewEntity[] }>('/api/admin/reviews');
      setItems(res.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load reviews.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const openCreate = () => {
    setEditing(null);
    setReviewer('');
    setOrganization('');
    setRole('Asset Manager');
    setRating('5');
    setServiceTag('REO Turnkey Preservation');
    setDateLabel('This month');
    setComment('');
    setPublicationStatus('Published');
    setModalOpen(true);
  };

  const openEdit = (r: ReviewEntity) => {
    setEditing(r);
    setReviewer(r.reviewer);
    setOrganization(r.organization);
    setRole(r.role);
    setRating(String(r.rating));
    setServiceTag(r.serviceTag);
    setDateLabel(r.dateLabel);
    setComment(r.comment);
    setPublicationStatus(r.publicationStatus);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      reviewer,
      organization,
      role,
      rating: Number(rating) || 5,
      serviceTag,
      dateLabel,
      comment,
      publicationStatus
    };
    try {
      if (editing) {
        await apiRequest(`/api/admin/reviews/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Review by "${reviewer}" updated.` });
      } else {
        await apiRequest('/api/admin/reviews', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Added manual testimonial for "${reviewer}".` });
      }
      setModalOpen(false);
      await loadReviews();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const updateStatus = async (id: string, next: ReviewPublicationStatus) => {
    try {
      await apiRequest(`/api/admin/reviews/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ publicationStatus: next })
      });
      await loadReviews();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Status update failed.' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/api/admin/reviews/${deleteTarget.id}`, { method: 'DELETE' });
      setToast({ type: 'success', text: `Deleted review.` });
      setDeleteTarget(null);
      await loadReviews();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Reviews &amp; Client Testimonials</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Moderate client testimonials synced to the About &amp; Reviews section. Admin-entered quotes are transparently marked as manual entries.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-[#052E16] px-4 py-2.5 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Add Manual Testimonial
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs">Loading reviews...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((r) => (
            <div
              key={r.id}
              className="flex flex-col justify-between rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      {Array.from({ length: r.rating }).map((_, idx) => (
                        <Star key={idx} className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                      ))}
                      <StatusBadge value={r.publicationStatus} className="ml-2" />
                    </div>
                    <h3 className="mt-2 font-display text-base font-bold">{r.reviewer}</h3>
                    <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
                      {r.role}
                      {r.organization ? ` · ${r.organization}` : ''} · {r.dateLabel}
                    </p>
                  </div>
                  <span className="rounded bg-emerald-950/8 px-2 py-0.5 text-[10px] font-semibold dark:bg-white/10">
                    {r.isDemo ? 'Sample Entry' : r.isVerifiedCustomer ? 'Verified' : 'Manual Entry'}
                  </span>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-[#052E16]/85 dark:text-lime-100/85">
                  &ldquo;{r.comment}&rdquo;
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-950/10 pt-3 text-xs dark:border-lime-300/15">
                <span className="text-[11px] font-semibold text-emerald-800 dark:text-lime-300">{r.serviceTag}</span>
                <div className="flex items-center gap-1.5">
                  {r.publicationStatus !== 'Published' && (
                    <button
                      type="button"
                      onClick={() => void updateStatus(r.id, 'Published')}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-900 cursor-pointer"
                    >
                      <Check className="h-3 w-3" /> Publish
                    </button>
                  )}
                  {r.publicationStatus !== 'Hidden' && (
                    <button
                      type="button"
                      onClick={() => void updateStatus(r.id, 'Hidden')}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-950/15 px-2 py-1 text-[11px] font-semibold cursor-pointer"
                    >
                      <EyeOff className="h-3 w-3" /> Hide
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="rounded-md border border-emerald-950/15 p-1.5 hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(r)}
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
            className="relative z-10 w-full max-w-lg rounded-xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {editing ? 'Edit Testimonial' : 'Add Manual Testimonial'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div>
                <label className="block font-semibold">Reviewer Name *</label>
                <input
                  required
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Organization</label>
                <input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Role / Title</label>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Rating (1–5)</label>
                <select
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} Stars
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold">Service Tag</label>
                <input
                  value={serviceTag}
                  onChange={(e) => setServiceTag(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Publication Status</label>
                <select
                  value={publicationStatus}
                  onChange={(e) => setPublicationStatus(e.target.value as ReviewPublicationStatus)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                >
                  <option value="Published">Published</option>
                  <option value="Approved">Approved</option>
                  <option value="Pending">Pending</option>
                  <option value="Hidden">Hidden</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">Review Quote *</label>
                <textarea
                  required
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
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
                Save Review
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Review"
        description={`Remove testimonial from "${deleteTarget?.reviewer}"?`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
