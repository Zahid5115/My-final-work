import React, { useState } from 'react';
import { Building2, CheckCircle2, ExternalLink, Mail, MapPin, Phone, Send, Star } from 'lucide-react';
import {
  GOOGLE_PROFILE_INFO,
  GOOGLE_REVIEWS,
  type GoogleReview
} from '../data/servicesData';
import { apiRequest } from '../services/api';

interface AboutAndReviewsProps {
  aboutHighlighted: boolean;
  onRequestBidClick: () => void;
  businessInfo?: typeof GOOGLE_PROFILE_INFO;
  reviews?: GoogleReview[];
}

export const AboutAndReviews: React.FC<AboutAndReviewsProps> = ({
  aboutHighlighted,
  onRequestBidClick,
  businessInfo = GOOGLE_PROFILE_INFO,
  reviews = GOOGLE_REVIEWS
}) => {
  const [contactOpen, setContactOpen] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [msgSent, setMsgSent] = useState(false);

  const reviewList = reviews.length > 0 ? reviews : GOOGLE_REVIEWS;

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsgError(null);
    setSending(true);
    try {
      await apiRequest('/api/public/messages', {
        method: 'POST',
        body: JSON.stringify({
          senderName,
          senderEmail,
          senderPhone,
          subject: subject || 'General Website Inquiry',
          body
        }),
        skipUnauthorizedCallback: true
      });
      setMsgSent(true);
      setSenderName('');
      setSenderEmail('');
      setSenderPhone('');
      setSubject('');
      setBody('');
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      id="about"
      className="bg-[#F6FAF1] dark:bg-[#03170C]"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        {/* Executive LLC Profile (Highlighted when About is clicked) */}
        <div
          className={`grid grid-cols-1 gap-10 rounded-2xl border p-6 sm:p-10 transition-all duration-300 lg:grid-cols-12 ${
            aboutHighlighted
              ? 'border-[#052E16] ring-2 ring-[#052E16]/35 bg-[#ECFCCB] dark:border-lime-400 dark:ring-lime-400/45 dark:bg-[#0A3820]'
              : 'border-emerald-950/12 bg-white dark:border-lime-300/20 dark:bg-[#072716]'
          }`}
        >
          <div className="min-w-0 lg:col-span-6">
            <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-emerald-800 dark:text-lime-300">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              About the LLC
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#052E16] dark:text-lime-50">
              {businessInfo.businessName}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#052E16]/80 dark:text-lime-100/80">
              U.S.-registered field services &amp; lawn preservation contractor serving institutional
              mortgage servicers, REO asset managers, property managers, and homeowners with rapid
              work-order turnaround and transparent pricing.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onRequestBidClick}
                className="rounded-lg bg-[#052E16] px-5 py-2.5 text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] dark:hover:bg-lime-300 transition-colors cursor-pointer"
              >
                Request Estimate / Bid
              </button>
              <button
                type="button"
                onClick={() => {
                  setContactOpen((o) => !o);
                  setMsgSent(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-950/20 px-4 py-2.5 text-sm font-semibold text-[#052E16] hover:bg-lime-100 dark:border-lime-300/30 dark:text-lime-100 dark:hover:bg-white/5 cursor-pointer"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Send Message
              </button>
              <a
                href={businessInfo.googleMapsProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-950/20 px-4 py-2.5 text-sm font-semibold text-[#052E16] hover:bg-lime-100 dark:border-lime-300/30 dark:text-lime-100 dark:hover:bg-white/5"
              >
                Google Business Profile
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          <dl className="divide-y divide-emerald-950/12 border-y border-emerald-950/12 dark:divide-lime-300/15 dark:border-lime-300/15 min-w-0 lg:col-span-6">
            <div className="flex items-start gap-3 py-4">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800 dark:text-lime-400" aria-hidden="true" />
              <div>
                <dt className="text-xs font-semibold text-[#052E16]/65 dark:text-lime-300/80">
                  Registered Company Name
                </dt>
                <dd className="mt-0.5 text-sm font-bold text-[#052E16] dark:text-lime-50">
                  {businessInfo.businessName}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3 py-4">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800 dark:text-lime-400" aria-hidden="true" />
              <div>
                <dt className="text-xs font-semibold text-[#052E16]/65 dark:text-lime-300/80">
                  Headquarters Location
                </dt>
                <dd className="mt-0.5 text-sm font-semibold text-[#052E16] dark:text-lime-50">
                  {businessInfo.address}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3 py-4">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800 dark:text-lime-400" aria-hidden="true" />
              <div>
                <dt className="text-xs font-semibold text-[#052E16]/65 dark:text-lime-300/80">
                  Direct Contact &amp; Hours
                </dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-[#052E16] dark:text-lime-50">
                  <a href={`tel:${businessInfo.phone.replace(/[^+\d]/g, '')}`} className="font-mono-tabular hover:underline">
                    {businessInfo.phone}
                  </a>
                  <a
                    href={`mailto:${businessInfo.email}`}
                    className="inline-flex items-center gap-1.5 hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    {businessInfo.email}
                  </a>
                </dd>
                <p className="mt-1 text-xs text-[#052E16]/75 dark:text-lime-200/80">
                  {businessInfo.hours}
                </p>
              </div>
            </div>
          </dl>

          {contactOpen && (
            <div className="border-t border-emerald-950/12 pt-6 dark:border-lime-300/15 lg:col-span-12">
              {msgSent ? (
                <div className="flex items-center gap-2 rounded-lg bg-[#BEF264] p-4 text-xs font-bold text-[#052E16]">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Message delivered to our office coordinators. We will follow up shortly.</span>
                </div>
              ) : (
                <form onSubmit={handleSendMessage} className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <input
                    type="text"
                    required
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="Your Name *"
                    className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-[#052E16] dark:border-lime-300/20 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                  <input
                    type="email"
                    required
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    placeholder="Email Address *"
                    className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-[#052E16] dark:border-lime-300/20 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                  <input
                    type="tel"
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    placeholder="Phone (Optional)"
                    className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-[#052E16] dark:border-lime-300/20 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject (e.g. Portfolio Onboarding)"
                    className="sm:col-span-3 rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-[#052E16] dark:border-lime-300/20 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                  <textarea
                    required
                    rows={2}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="How can Smoker's Lawn Care Service LLC assist your team?"
                    className="sm:col-span-3 rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-[#052E16] dark:border-lime-300/20 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                  {msgError && (
                    <p role="alert" className="sm:col-span-3 font-semibold text-red-700 dark:text-orange-300">
                      {msgError}
                    </p>
                  )}
                  <div className="sm:col-span-3 flex justify-end">
                    <button
                      type="submit"
                      disabled={sending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#052E16] px-4 py-2 font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer disabled:opacity-60"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {sending ? 'Sending...' : 'Send Office Message'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Google Business Profile Reviews */}
        <div className="mt-14">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wide text-emerald-800 dark:text-lime-300">
                Google Business Profile Ratings
              </p>
              <h3 className="mt-1 font-display text-2xl font-bold text-[#052E16] dark:text-lime-50">
                {businessInfo.rating} / 5.0 Rating Across {businessInfo.reviewCount} Verified Reviews
              </h3>
            </div>
            <div className="flex items-center gap-1 text-amber-500 dark:text-lime-400" aria-label="4.9 out of 5 stars">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-current" aria-hidden="true" />
              ))}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 divide-y divide-emerald-950/12 border-y border-emerald-950/12 dark:divide-lime-300/15 dark:border-lime-300/15 md:grid-cols-3 md:divide-y-0 md:divide-x">
            {reviewList.map((review) => (
              <article
                key={review.id}
                className="flex flex-col justify-between py-6 md:px-6 first:md:pl-0 last:md:pr-0"
              >
                <div>
                  <p className="text-xs font-semibold text-emerald-800 dark:text-lime-300">
                    {review.serviceTag} · {review.dateLabel}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-[#052E16]/90 dark:text-lime-100/90">
                    &ldquo;{review.comment}&rdquo;
                  </p>
                </div>
                <div className="mt-5">
                  <p className="text-sm font-bold text-[#052E16] dark:text-lime-50">
                    {review.reviewer}
                  </p>
                  <p className="text-xs text-[#052E16]/75 dark:text-lime-200/75">
                    {review.role} · {review.organization}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
