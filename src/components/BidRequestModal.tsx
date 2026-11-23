import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, X } from 'lucide-react';
import { apiRequest } from '../services/api';
import type { EstimatePayload } from './QuoteEstimator';

interface BidRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefilledEstimate: EstimatePayload | null;
}

export const BidRequestModal: React.FC<BidRequestModalProps> = ({
  isOpen,
  onClose,
  prefilledEstimate
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [serviceScope, setServiceScope] = useState('Property Preservation & Debris Removal');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (prefilledEstimate) {
      setServiceScope(prefilledEstimate.categoryLabel);
      setNotes(
        `Estimator Quote Range: $${prefilledEstimate.lowEstimate.toLocaleString()} – $${prefilledEstimate.highEstimate.toLocaleString()} (${prefilledEstimate.summary})`
      );
      setSubmittedRef(null);
    }
  }, [prefilledEstimate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !email.includes('@') || phone.trim().length < 7 || !propertyAddress.trim()) {
      setFormError('Please enter your name, valid email, phone number, and property address.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ requestCode: string }>('/api/public/bid-requests', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          phone,
          propertyAddress,
          serviceScope,
          notes,
          estimatorData: prefilledEstimate
            ? {
                categoryLabel: prefilledEstimate.categoryLabel,
                lowEstimate: prefilledEstimate.lowEstimate,
                highEstimate: prefilledEstimate.highEstimate,
                summary: prefilledEstimate.summary
              }
            : null
        }),
        skipUnauthorizedCallback: true
      });
      setSubmittedRef(res.requestCode);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bid-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-emerald-950/65 backdrop-blur-xs"
          />

          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-lg rounded-xl border border-emerald-950/20 bg-[#FAFFF0] p-6 shadow-2xl dark:border-lime-300/25 dark:bg-[#072716] sm:p-8"
          >
            <div className="flex items-start justify-between gap-4 border-b border-emerald-950/15 pb-4 dark:border-lime-300/15">
              <div>
                <h2
                  id="bid-modal-title"
                  className="font-display text-2xl font-bold text-emerald-950 dark:text-lime-50"
                >
                  Request a Bid / Work Order
                </h2>
                <p className="mt-1 text-xs text-emerald-950/75 dark:text-lime-200/80">
                  Smoker&apos;s Lawn Care Service LLC · Same-day dispatch confirmation
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="flex h-8 w-8 items-center justify-center rounded-md text-emerald-950 hover:bg-emerald-950/10 dark:text-lime-200 dark:hover:bg-lime-400/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {submittedRef ? (
              <div className="mt-6 space-y-4 text-emerald-950 dark:text-lime-100">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-6 w-6 text-emerald-800 dark:text-lime-400" aria-hidden="true" />
                  <h3 className="font-display text-xl font-bold">Work Order Logged</h3>
                </div>
                <p className="text-sm">
                  Tracking Reference: <strong className="font-mono-tabular">{submittedRef}</strong>. Our
                  dispatch coordinator will contact <strong>{name}</strong> at{' '}
                  <strong className="font-mono-tabular">{phone}</strong> regarding{' '}
                  <strong>{propertyAddress}</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSubmittedRef(null);
                    onClose();
                  }}
                  className="w-full rounded-md bg-emerald-950 px-4 py-2.5 text-sm font-semibold text-lime-200 dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="modal-name" className="block text-xs font-semibold text-emerald-950 dark:text-lime-100">
                      Full Name *
                    </label>
                    <input
                      id="modal-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Morgan"
                      className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="modal-phone" className="block text-xs font-semibold text-emerald-950 dark:text-lime-100">
                      Phone Number *
                    </label>
                    <input
                      id="modal-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(317) 555-0182"
                      className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="modal-email" className="block text-xs font-semibold text-emerald-950 dark:text-lime-100">
                      Email Address *
                    </label>
                    <input
                      id="modal-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="manager@portfolio.com"
                      className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="modal-scope" className="block text-xs font-semibold text-emerald-950 dark:text-lime-100">
                      Service Scope
                    </label>
                    <select
                      id="modal-scope"
                      value={serviceScope}
                      onChange={(e) => setServiceScope(e.target.value)}
                      className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    >
                      <option>Property Preservation &amp; Debris Removal</option>
                      <option>Lawn Care &amp; Grounds Maintenance</option>
                      <option>Debris Removal &amp; Trash-Out</option>
                      <option>Handyman &amp; REO Repairs</option>
                      <option>Winterization &amp; Securing</option>
                      <option>Emergency Storm Damage Assessment</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="modal-address" className="block text-xs font-semibold text-emerald-950 dark:text-lime-100">
                    Property Address, City &amp; State *
                  </label>
                  <input
                    id="modal-address"
                    type="text"
                    required
                    value={propertyAddress}
                    onChange={(e) => setPropertyAddress(e.target.value)}
                    placeholder="1426 Maple Ridge Ave, Indianapolis, IN"
                    className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                </div>

                <div>
                  <label htmlFor="modal-notes" className="block text-xs font-semibold text-emerald-950 dark:text-lime-100">
                    Scope / Lockbox Notes
                  </label>
                  <textarea
                    id="modal-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Yard condition, debris volume, or lockbox code..."
                    className="mt-1 w-full rounded-md border border-emerald-950/20 bg-white px-3 py-2 text-sm text-emerald-950 dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                </div>

                {formError && (
                  <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md bg-emerald-950 px-5 py-3 text-sm font-semibold text-lime-200 hover:bg-emerald-900 dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {submitting ? 'Submitting Work Order...' : 'Submit Work Order / Bid Request'}
                </button>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
