import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import type { CoverageRegionEntity } from '../../types/platform';

export const CoverageAdminPage: React.FC = () => {
  const [items, setItems] = useState<CoverageRegionEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CoverageRegionEntity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CoverageRegionEntity | null>(null);

  const [region, setRegion] = useState('');
  const [hubCity, setHubCity] = useState('');
  const [statesText, setStatesText] = useState('');
  const [countiesText, setCountiesText] = useState('');
  const [activeCounties, setActiveCounties] = useState('24');
  const [avgDispatchHours, setAvgDispatchHours] = useState('24');
  const [hudStandard, setHudStandard] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [coverageStatus, setCoverageStatus] = useState<'Active' | 'Expanding' | 'Paused'>('Active');
  const [isHeadquarters, setIsHeadquarters] = useState(false);
  const [isPublished, setIsPublished] = useState(true);

  const loadCoverage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ items: CoverageRegionEntity[] }>('/api/admin/coverage');
      setItems(res.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load coverage regions.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  const openCreate = () => {
    setEditing(null);
    setRegion('');
    setHubCity('');
    setStatesText('');
    setCountiesText('');
    setActiveCounties('20');
    setAvgDispatchHours('24');
    setHudStandard('HUD/FHA First-Time Vacancy & Securing');
    setLat('');
    setLng('');
    setCoverageStatus('Active');
    setIsHeadquarters(false);
    setIsPublished(true);
    setModalOpen(true);
  };

  const openEdit = (r: CoverageRegionEntity) => {
    setEditing(r);
    setRegion(r.region);
    setHubCity(r.hubCity);
    setStatesText(r.states.join(', '));
    setCountiesText(r.counties.join(', '));
    setActiveCounties(String(r.activeCounties));
    setAvgDispatchHours(String(r.avgDispatchHours));
    setHudStandard(r.hudStandard);
    setLat(r.lat !== null ? String(r.lat) : '');
    setLng(r.lng !== null ? String(r.lng) : '');
    setCoverageStatus(r.coverageStatus);
    setIsHeadquarters(r.isHeadquarters);
    setIsPublished(r.isPublished);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      region,
      hubCity,
      states: statesText
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
      counties: countiesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      activeCounties: Number(activeCounties) || 0,
      avgDispatchHours: Number(avgDispatchHours) || 24,
      hudStandard,
      lat: lat.trim() ? Number(lat) : null,
      lng: lng.trim() ? Number(lng) : null,
      coverageStatus,
      isHeadquarters,
      isPublished
    };
    try {
      if (editing) {
        await apiRequest(`/api/admin/coverage/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Updated coverage region "${region}".` });
      } else {
        await apiRequest('/api/admin/coverage', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setToast({ type: 'success', text: `Created coverage region "${region}".` });
      }
      setModalOpen(false);
      await loadCoverage();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const togglePublished = async (r: CoverageRegionEntity) => {
    try {
      await apiRequest(`/api/admin/coverage/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: !r.isPublished })
      });
      await loadCoverage();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/api/admin/coverage/${deleteTarget.id}`, { method: 'DELETE' });
      setToast({ type: 'success', text: `Removed region "${deleteTarget.region}".` });
      setDeleteTarget(null);
      await loadCoverage();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Service Coverage &amp; Google Map Hubs</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Manage regional service hubs, county counts, SLA targets, and interactive map coordinates.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-[#052E16] px-4 py-2.5 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Add Coverage Region
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs">Loading coverage regions...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-emerald-700 dark:text-lime-300" />
                    <h3 className="font-display text-base font-bold">{r.region}</h3>
                    {r.isHeadquarters && (
                      <span className="rounded bg-[#BEF264] px-1.5 py-0.5 text-[10px] font-bold text-[#052E16]">
                        HQ
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-[#052E16]/75 dark:text-lime-200/75">
                    Hub: {r.hubCity} · States: {r.states.join(', ') || 'N/A'}
                  </p>
                </div>
                <StatusBadge value={r.coverageStatus} />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-[#F6FAF1] p-3 text-xs dark:bg-[#03170C]">
                <div>
                  <span className="block text-[10px] text-[#052E16]/60 dark:text-lime-200/60">Counties</span>
                  <span className="font-mono-tabular font-bold">{r.activeCounties}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-[#052E16]/60 dark:text-lime-200/60">Dispatch SLA</span>
                  <span className="font-mono-tabular font-bold">{r.avgDispatchHours}h</span>
                </div>
                <div>
                  <span className="block text-[10px] text-[#052E16]/60 dark:text-lime-200/60">Coordinates</span>
                  <span className="font-mono-tabular text-[11px] font-semibold">
                    {r.lat !== null && r.lng !== null ? `${r.lat.toFixed(2)}, ${r.lng.toFixed(2)}` : 'Unset'}
                  </span>
                </div>
              </div>

              {r.hudStandard && (
                <p className="mt-2.5 text-xs text-[#052E16]/75 dark:text-lime-200/75">{r.hudStandard}</p>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-emerald-950/10 pt-3 text-xs dark:border-lime-300/15">
                <span className="font-semibold">{r.isPublished ? 'Published on Public Map' : 'Hidden Draft'}</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void togglePublished(r)}
                    className="rounded-md border border-emerald-950/15 p-1.5 hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                  >
                    {r.isPublished ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
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
            className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {editing ? 'Edit Coverage Region' : 'Add Coverage Region'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block font-semibold">Region Name *</label>
                <input
                  required
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g. Midwest Core"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Dispatch Hub City *</label>
                <input
                  required
                  value={hubCity}
                  onChange={(e) => setHubCity(e.target.value)}
                  placeholder="Indianapolis, IN"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Status</label>
                <select
                  value={coverageStatus}
                  onChange={(e) => setCoverageStatus(e.target.value as 'Active' | 'Expanding' | 'Paused')}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                >
                  <option value="Active">Active</option>
                  <option value="Expanding">Expanding</option>
                  <option value="Paused">Paused</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">States Covered (comma separated)</label>
                <input
                  value={statesText}
                  onChange={(e) => setStatesText(e.target.value)}
                  placeholder="IN, OH, IL, KY, MI"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Active Counties Count</label>
                <input
                  type="number"
                  min={0}
                  value={activeCounties}
                  onChange={(e) => setActiveCounties(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Avg Dispatch SLA (Hours)</label>
                <input
                  type="number"
                  min={1}
                  value={avgDispatchHours}
                  onChange={(e) => setAvgDispatchHours(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="39.7684"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="-86.1581"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold">HUD / Compliance Standard Note</label>
                <input
                  value={hudStandard}
                  onChange={(e) => setHudStandard(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isHeadquarters} onChange={(e) => setIsHeadquarters(e.target.checked)} />
                <span className="font-semibold">Mark as Headquarters Hub</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
                <span className="font-semibold">Publish on Public Map</span>
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
                Save Region
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Coverage Region"
        description={`Remove "${deleteTarget?.region}" from coverage hubs?`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
