import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Check, Mail, Search } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import type { ContactMessageEntity, MessageStatus } from '../../types/platform';

export const MessagesAdminPage: React.FC = () => {
  const [items, setItems] = useState<ContactMessageEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContactMessageEntity | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (search.trim()) params.set('q', search.trim());
      const res = await apiRequest<{ items: ContactMessageEntity[] }>(`/api/admin/messages?${params.toString()}`);
      setItems(res.items);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load messages.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const updateMessage = async (id: string, payload: { status?: MessageStatus; internalNotes?: string }) => {
    try {
      const res = await apiRequest<{ item: ContactMessageEntity }>(`/api/admin/messages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setToast({ type: 'success', text: 'Message updated.' });
      if (selected && selected.id === id) {
        setSelected(res.item);
        setNotesDraft(res.item.internalNotes);
      }
      await loadMessages();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div>
        <h2 className="font-display text-2xl font-bold">Messages &amp; General Inquiries</h2>
        <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
          Respond to public contact inquiries, mark follow-ups, and record internal notes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#052E16]/50 dark:text-lime-200/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sender, subject, or message body..."
            className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] py-2 pr-3 pl-9 text-xs dark:border-lime-300/20 dark:bg-[#03170C]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter message status"
          className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
        >
          <option value="All">All Messages</option>
          <option value="Unread">Unread</option>
          <option value="Read">Read</option>
          <option value="Responded">Responded</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-2.5 lg:col-span-2">
          {loading ? (
            <div className="rounded-xl border border-emerald-950/12 bg-white p-10 text-center text-xs dark:border-lime-300/15 dark:bg-[#072716]">
              Loading messages...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-emerald-950/12 bg-white p-10 text-center text-xs dark:border-lime-300/15 dark:bg-[#072716]">
              Inbox is clear — no matching messages.
            </div>
          ) : (
            items.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSelected(m);
                  setNotesDraft(m.internalNotes || '');
                  if (m.status === 'Unread') {
                    void updateMessage(m.id, { status: 'Read' });
                  }
                }}
                className={`w-full rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                  selected?.id === m.id
                    ? 'border-[#052E16] bg-lime-50 dark:border-lime-400 dark:bg-[#0B351E]'
                    : 'border-emerald-950/12 bg-white hover:bg-[#F6FAF1] dark:border-lime-300/15 dark:bg-[#072716]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-emerald-700 dark:text-lime-300" />
                    <span className="font-display text-sm font-bold">{m.senderName}</span>
                    <StatusBadge value={m.status} />
                  </div>
                  <span className="text-[11px] text-[#052E16]/60 dark:text-lime-200/60">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-emerald-800 dark:text-lime-300">{m.subject}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[#052E16]/75 dark:text-lime-200/75">{m.body}</p>
              </button>
            ))
          )}
        </div>

        <div className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716] h-fit">
          {!selected ? (
            <div className="py-10 text-center text-xs text-[#052E16]/60 dark:text-lime-200/60">
              Select a message to read details, log follow-ups, or update status.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="flex items-start justify-between gap-2 border-b border-emerald-950/10 pb-3 dark:border-lime-300/15">
                <div>
                  <h3 className="font-display text-base font-bold">{selected.subject}</h3>
                  <p className="mt-0.5 font-semibold">{selected.senderName}</p>
                  <p className="text-[#052E16]/70 dark:text-lime-200/75">
                    {selected.senderEmail} {selected.senderPhone ? `· ${selected.senderPhone}` : ''}
                  </p>
                </div>
                <StatusBadge value={selected.status} />
              </div>

              <div className="rounded-lg bg-[#F6FAF1] p-3 leading-relaxed dark:bg-[#03170C]">
                {selected.body}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void updateMessage(selected.id, { status: 'Responded' })}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#052E16] px-3 py-1.5 font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" /> Mark Responded
                </button>
                <button
                  type="button"
                  onClick={() => void updateMessage(selected.id, { status: 'Archived' })}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-950/15 px-3 py-1.5 font-semibold dark:border-lime-300/20 cursor-pointer"
                >
                  <Archive className="h-3.5 w-3.5" /> Archive
                </button>
              </div>

              <div>
                <label className="block font-semibold">Internal Coordinator Notes</label>
                <textarea
                  rows={3}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
                <button
                  type="button"
                  onClick={() => void updateMessage(selected.id, { internalNotes: notesDraft })}
                  className="mt-2 rounded-lg border border-emerald-950/15 px-3 py-1.5 font-semibold hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                >
                  Save Notes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
