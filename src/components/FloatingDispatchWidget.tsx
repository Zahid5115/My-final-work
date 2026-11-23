import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, MessageSquare, Phone, Send, ShieldAlert, X } from 'lucide-react';
import { GOOGLE_PROFILE_INFO } from '../data/servicesData';
import { apiRequest } from '../services/api';

const URGENT_TOPICS = [
  'Emergency Board-Up / Securing',
  'Storm Damage & Roof Tarping',
  'Municipal Grass / Debris Citation',
  'Same-Day Lock Change / Winterization'
] as const;

export const FloatingDispatchWidget: React.FC<{ businessPhone?: string }> = ({
  businessPhone = GOOGLE_PROFILE_INFO.phone
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [topic, setTopic] = useState<string>(URGENT_TOPICS[0]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [propertyLocation, setPropertyLocation] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || phone.trim().length < 7 || !propertyLocation.trim()) {
      setError('Please enter your name, callback phone number, and property city/state.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ dispatchCode: string }>('/api/public/dispatch-requests', {
        method: 'POST',
        body: JSON.stringify({
          topic,
          name,
          phone,
          propertyLocation,
          message
        }),
        skipUnauthorizedCallback: true
      });
      setTicketId(res.dispatchCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach urgent dispatch desk.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setTicketId(null);
    setName('');
    setPhone('');
    setPropertyLocation('');
    setMessage('');
    setError(null);
  };

  return (
    <>
      {/* Floating Urgent Dispatch / Live Contact Trigger */}
      <div className="fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open urgent property preservation dispatch contact"
          aria-expanded={isOpen}
          className="inline-flex items-center gap-2.5 rounded-lg border border-lime-200/30 bg-emerald-950 px-4 py-3 text-sm font-semibold text-lime-200 shadow-lg hover:bg-emerald-900 dark:border-[#052E16]/30 dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-950 dark:focus-visible:outline-lime-300"
        >
          <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">Urgent Dispatch</span>
        </button>
      </div>

      {/* Urgent Dispatch Contact Modal */}
      <AnimatePresence>
        {isOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="urgent-dispatch-title"
            className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:items-center sm:justify-center"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-emerald-950/65 backdrop-blur-xs"
            />

            <motion.div
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-full max-w-md rounded-xl border border-emerald-950/20 bg-[#FAFFF0] p-6 shadow-2xl dark:border-lime-300/25 dark:bg-[#072716]"
            >
              <div className="flex items-start justify-between gap-4 border-b border-emerald-950/15 pb-4 dark:border-lime-300/15">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 dark:text-lime-300">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    24/7 Urgent Preservation Desk
                  </p>
                  <h2
                    id="urgent-dispatch-title"
                    className="mt-1 font-display text-xl font-bold text-emerald-950 dark:text-lime-50"
                  >
                    Connect With Live Dispatch
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close urgent dispatch modal"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-emerald-950 hover:bg-emerald-950/10 dark:text-lime-200 dark:hover:bg-lime-400/10 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Direct Emergency Line Strip */}
              <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-950 px-4 py-3 text-lime-100 dark:bg-lime-400 dark:text-[#052E16]">
                <span className="text-xs font-medium">Immediate Phone Dispatch</span>
                <a
                  href={`tel:${businessPhone.replace(/[^+\d]/g, '')}`}
                  className="inline-flex items-center gap-1.5 font-mono-tabular text-sm font-bold underline-offset-4 hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {businessPhone}
                </a>
              </div>

              {ticketId ? (
                <div className="mt-5 space-y-4 text-emerald-950 dark:text-lime-100">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2
                      className="h-6 w-6 shrink-0 text-emerald-800 dark:text-lime-400"
                      aria-hidden="true"
                    />
                    <h3 className="font-display text-lg font-bold">
                      Urgent Dispatch Ticket Logged
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed">
                    Priority Ticket <strong className="font-mono-tabular">{ticketId}</strong> for{' '}
                    <strong>{topic}</strong> at <strong>{propertyLocation}</strong> has been routed
                    to the regional coordinator. Expect a callback at{' '}
                    <strong className="font-mono-tabular">{phone}</strong> within 15 minutes.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="flex-1 rounded-md border border-emerald-950/25 px-4 py-2.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-950/5 dark:border-lime-300/30 dark:text-lime-100 cursor-pointer"
                    >
                      New Message
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="flex-1 rounded-md bg-emerald-950 px-4 py-2.5 text-xs font-semibold text-lime-200 dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                  <div>
                    <label
                      htmlFor="urgent-topic"
                      className="block text-xs font-semibold text-emerald-950 dark:text-lime-100"
                    >
                      Urgent Service Needed
                    </label>
                    <select
                      id="urgent-topic"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    >
                      {URGENT_TOPICS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="urgent-name"
                        className="block text-xs font-semibold text-emerald-950 dark:text-lime-100"
                      >
                        Your Name *
                      </label>
                      <input
                        id="urgent-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alex Morgan"
                        className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="urgent-phone"
                        className="block text-xs font-semibold text-emerald-950 dark:text-lime-100"
                      >
                        Callback Phone *
                      </label>
                      <input
                        id="urgent-phone"
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="(317) 555-0182"
                        className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="urgent-location"
                      className="block text-xs font-semibold text-emerald-950 dark:text-lime-100"
                    >
                      Property City &amp; State / Address *
                    </label>
                    <input
                      id="urgent-location"
                      type="text"
                      required
                      value={propertyLocation}
                      onChange={(e) => setPropertyLocation(e.target.value)}
                      placeholder="417 Oak St, Indianapolis, IN"
                      className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="urgent-message"
                      className="block text-xs font-semibold text-emerald-950 dark:text-lime-100"
                    >
                      Urgent Notes / Access Code
                    </label>
                    <textarea
                      id="urgent-message"
                      rows={2}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Describe damage, citation deadline, or lockbox code..."
                      className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>

                  {error && (
                    <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-950 px-5 py-3 text-sm font-semibold text-lime-200 hover:bg-emerald-900 dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {submitting ? 'Routing Urgent Dispatch...' : 'Send Urgent Dispatch Request'}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
