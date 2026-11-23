import React, { useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, Shield } from 'lucide-react';
import { SAMPLE_WORK_ORDERS, type WorkOrderRecord } from '../data/servicesData';
import { apiRequest } from '../services/api';

export const VendorPortal: React.FC<{ workOrders?: WorkOrderRecord[] }> = ({
  workOrders = SAMPLE_WORK_ORDERS
}) => {
  const openBidOrders = workOrders.filter(
    (wo) => wo.status === 'Open Bid' || wo.status === 'Dispatched'
  );
  const [activeTab, setActiveTab] = useState<'portal' | 'application'>('portal');
  const [selectedOrderForBid, setSelectedOrderForBid] = useState<string>(
    openBidOrders[0]?.id ?? SAMPLE_WORK_ORDERS[3].id
  );
  const [bidAmount, setBidAmount] = useState<string>('890');
  const [vendorCode, setVendorCode] = useState<string>('');
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidSubmittedMsg, setBidSubmittedMsg] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [statesCovered, setStatesCovered] = useState('');
  const [trades, setTrades] = useState<string[]>(['Lawn Maintenance', 'Debris Removal']);
  const [hasInsurance, setHasInsurance] = useState(true);
  const [appSubmitting, setAppSubmitting] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [appSuccessId, setAppSuccessId] = useState<string | null>(null);

  useEffect(() => {
    if (openBidOrders.length > 0 && !openBidOrders.some((o) => o.id === selectedOrderForBid)) {
      setSelectedOrderForBid(openBidOrders[0].id);
      setBidAmount(String(openBidOrders[0].estimatedBudget));
    }
  }, [openBidOrders, selectedOrderForBid]);

  const handleToggleTrade = (trade: string) => {
    setTrades((prev) =>
      prev.includes(trade) ? prev.filter((t) => t !== trade) : [...prev, trade]
    );
  };

  const handleBidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBidError(null);
    if (!bidAmount || Number(bidAmount) < 25) {
      setBidError('Please enter a valid bid amount of at least $25.');
      return;
    }
    setBidSubmitting(true);
    try {
      const res = await apiRequest<{ bidCode: string; workOrderCode: string }>('/api/public/vendor-bids', {
        method: 'POST',
        body: JSON.stringify({
          workOrderCode: selectedOrderForBid,
          proposedPrice: Number(bidAmount),
          vendorCode
        }),
        skipUnauthorizedCallback: true
      });
      setBidSubmittedMsg(
        `Vendor bid ${res.bidCode} ($${Number(bidAmount).toLocaleString()}) logged for ${res.workOrderCode}${vendorCode ? ` (ABC# ${vendorCode})` : ''}. Dispatch responds within 2 hours.`
      );
      setVendorCode('');
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Unable to submit bid right now.');
    } finally {
      setBidSubmitting(false);
    }
  };

  const handleApplicationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAppError(null);

    if (!companyName.trim() || !contactName.trim() || !email.includes('@') || phone.trim().length < 7) {
      setAppError('Please provide your LLC/Company name, contact name, valid email, and phone number.');
      return;
    }
    if (trades.length === 0) {
      setAppError('Please select at least one primary field service trade.');
      return;
    }

    setAppSubmitting(true);
    try {
      const res = await apiRequest<{ vendorCode: string }>('/api/public/vendor-applications', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          contactName,
          email,
          phone,
          statesCovered,
          trades,
          hasInsurance
        }),
        skipUnauthorizedCallback: true
      });
      setAppSuccessId(res.vendorCode);
    } catch (err) {
      setAppError(err instanceof Error ? err.message : 'Unable to submit application right now.');
    } finally {
      setAppSubmitting(false);
    }
  };

  return (
    <section
      id="vendor-portal"
      className="border-b border-emerald-950/10 bg-white dark:border-lime-300/15 dark:bg-[#052312]"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="flex flex-col gap-4 border-b border-emerald-950/10 pb-6 dark:border-lime-300/15 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-emerald-800 dark:text-lime-300">
              <Briefcase className="h-4 w-4" aria-hidden="true" />
              Partner Network
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#052E16] dark:text-lime-50 sm:text-4xl">
              Vendor Portal &amp; Field Crew Application
            </h2>
          </div>

          <div role="tablist" aria-label="Vendor Portal Views" className="flex gap-2">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'portal'}
              onClick={() => setActiveTab('portal')}
              className={`rounded-lg px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'portal'
                  ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                  : 'border border-emerald-950/15 bg-[#F6FAF1] text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
              }`}
            >
              Open Bid Portal
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'application'}
              onClick={() => setActiveTab('application')}
              className={`rounded-lg px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'application'
                  ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                  : 'border border-emerald-950/15 bg-[#F6FAF1] text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
              }`}
            >
              Vendor Application
            </button>
          </div>
        </div>

        {activeTab === 'portal' ? (
          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="space-y-6 min-w-0 lg:col-span-7">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-emerald-950/10 pb-4 text-xs font-medium text-[#052E16]/80 dark:border-lime-300/15 dark:text-lime-200/85">
                <span className="inline-flex items-center gap-1.5 font-bold text-[#052E16] dark:text-lime-300">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  Requirements:
                </span>
                <span>$1M/$2M GL Coverage</span>
                <span>·</span>
                <span>Aspen Grove ABC#</span>
                <span>·</span>
                <span>Net-15 ACH Payout</span>
              </div>

              <div className="divide-y divide-emerald-950/10 border-b border-emerald-950/10 dark:divide-lime-300/15 dark:border-lime-300/15">
                {openBidOrders.map((order) => {
                  const selected = selectedOrderForBid === order.id;
                  return (
                    <div
                      key={order.id}
                      className={`flex flex-col justify-between gap-3 py-4 px-3 rounded-lg sm:flex-row sm:items-center ${
                        selected ? 'bg-lime-100 dark:bg-lime-400/10' : ''
                      }`}
                    >
                      <div>
                        <p className="font-mono-tabular text-xs font-semibold text-emerald-800 dark:text-lime-300">
                          {order.id} · {order.cityState} ({order.slaDue})
                        </p>
                        <p className="mt-0.5 text-sm font-bold text-[#052E16] dark:text-lime-50">
                          {order.serviceType}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOrderForBid(order.id);
                          setBidAmount(String(order.estimatedBudget));
                          setBidSubmittedMsg(null);
                        }}
                        className={`shrink-0 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                            : 'border border-emerald-950/20 text-[#052E16] hover:bg-lime-100 dark:border-lime-300/25 dark:text-lime-100'
                        }`}
                      >
                        {selected ? 'Selected' : 'Bid Order'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-950/12 bg-[#F6FAF1] p-6 dark:border-lime-300/20 dark:bg-[#072716] min-w-0 lg:col-span-5">
              <h3 className="font-display text-xl font-bold text-[#052E16] dark:text-lime-50">
                Submit Vendor Bid
              </h3>
              <form onSubmit={handleBidSubmit} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="vendor-wo-id" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                    Work Order ID
                  </label>
                  <input
                    id="vendor-wo-id"
                    type="text"
                    readOnly
                    value={selectedOrderForBid}
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 font-mono-tabular text-sm font-semibold text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-200"
                  />
                </div>
                <div>
                  <label htmlFor="vendor-bid-amount" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                    Turnkey Bid (USD)
                  </label>
                  <input
                    id="vendor-bid-amount"
                    type="number"
                    min={50}
                    required
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 font-mono-tabular text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                </div>
                <div>
                  <label htmlFor="vendor-abc" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                    Aspen Grove ABC# (Optional)
                  </label>
                  <input
                    id="vendor-abc"
                    type="text"
                    placeholder="ABC-882410"
                    value={vendorCode}
                    onChange={(e) => setVendorCode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                </div>

                {bidError && (
                  <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                    {bidError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={bidSubmitting}
                  className="w-full rounded-lg bg-[#052E16] px-5 py-2.5 text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {bidSubmitting ? 'Submitting Bid...' : 'Submit Bid to Dispatch'}
                </button>
              </form>

              {bidSubmittedMsg && (
                <div
                  role="status"
                  className="mt-4 flex items-start gap-2 rounded-lg bg-[#BEF264] p-3 text-xs font-medium text-[#052E16]"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{bidSubmittedMsg}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-10 rounded-xl border border-emerald-950/12 bg-[#F6FAF1] p-6 sm:p-8 dark:border-lime-300/20 dark:bg-[#072716]">
            {appSuccessId ? (
              <div className="space-y-3 text-[#052E16] dark:text-lime-100">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-6 w-6 text-emerald-700 dark:text-lime-400" aria-hidden="true" />
                  <h3 className="font-display text-2xl font-bold">Vendor Application Received</h3>
                </div>
                <p className="text-sm">
                  Reference <strong className="font-mono-tabular">{appSuccessId}</strong> logged for{' '}
                  <strong>{companyName}</strong>. Onboarding paperwork has been queued for{' '}
                  <strong>{email}</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAppSuccessId(null);
                    setCompanyName('');
                    setContactName('');
                    setEmail('');
                    setPhone('');
                    setStatesCovered('');
                  }}
                  className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
                >
                  Submit Another Application
                </button>
              </div>
            ) : (
              <form onSubmit={handleApplicationSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-w-0 lg:col-span-7">
                  <div>
                    <label htmlFor="app-company" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                      Company / LLC Name *
                    </label>
                    <input
                      id="app-company"
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Midwest Field Pros LLC"
                      className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="app-contact" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                      Primary Contact *
                    </label>
                    <input
                      id="app-contact"
                      type="text"
                      required
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Jordan Alvarez"
                      className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="app-email" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                      Dispatch Email *
                    </label>
                    <input
                      id="app-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="dispatch@contractorllc.com"
                      className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="app-phone" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                      Phone Number *
                    </label>
                    <input
                      id="app-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(317) 555-0148"
                      className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="app-states" className="block text-xs font-semibold text-[#052E16] dark:text-lime-100">
                      Counties &amp; States Covered
                    </label>
                    <input
                      id="app-states"
                      type="text"
                      value={statesCovered}
                      onChange={(e) => setStatesCovered(e.target.value)}
                      placeholder="Marion, Hamilton (IN) · Franklin (OH)"
                      className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                    />
                  </div>
                </div>

                <div className="flex flex-col justify-between space-y-4 min-w-0 lg:col-span-5">
                  <div>
                    <p className="text-xs font-semibold text-[#052E16] dark:text-lime-200">
                      Field Trades Covered
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[
                        'Lawn Maintenance',
                        'Debris Removal',
                        'Lock Changes & Boarding',
                        'Winterization',
                        'Drywall & Painting',
                        'Plumbing / Electrical'
                      ].map((trade) => (
                        <label key={trade} className="flex cursor-pointer items-center gap-2 text-xs text-[#052E16] dark:text-lime-100">
                          <input
                            type="checkbox"
                            checked={trades.includes(trade)}
                            onChange={() => handleToggleTrade(trade)}
                            className="h-4 w-4 accent-[#052E16] dark:accent-lime-400"
                          />
                          <span>{trade}</span>
                        </label>
                      ))}
                    </div>

                    <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-[#052E16]/85 dark:text-lime-200/85">
                      <input
                        type="checkbox"
                        checked={hasInsurance}
                        onChange={(e) => setHasInsurance(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[#052E16] dark:accent-lime-400"
                      />
                      <span>Active GL insurance &amp; Aspen Grove ABC# compliant</span>
                    </label>
                  </div>

                  {appError && (
                    <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                      {appError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={appSubmitting}
                    className="w-full rounded-lg bg-[#052E16] px-5 py-3 text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {appSubmitting ? 'Submitting Application...' : 'Submit Vendor Application'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
