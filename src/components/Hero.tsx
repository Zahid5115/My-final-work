import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, CheckCircle2, Phone, ShieldCheck, Star } from 'lucide-react';
import { GOOGLE_PROFILE_INFO, HERO_IMAGE } from '../data/servicesData';

interface HeroProps {
  onEstimateClick: () => void;
  onRequestBidClick: () => void;
}

const CREDENTIAL_BAR = [
  { label: 'Liability & Bonding', value: '$2M GL / E&O' },
  { label: 'Emergency Dispatch', value: '24/7 Nationwide' },
  { label: 'Technician Screening', value: 'Aspen Grove ABC#' },
  { label: 'Photo Audit SLA', value: '24–48 Hours' }
];

export const Hero: React.FC<HeroProps> = ({ onEstimateClick, onRequestBidClick }) => {
  const [imgError, setImgError] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  return (
    <section id="top" className="relative overflow-hidden bg-[#052E16] text-lime-50 dark:bg-[#021209]">
      {/* Subtle Architectural Radial Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-lime-400/15 blur-3xl"
      />

      <div className="mx-auto max-w-7xl px-4 pt-10 pb-14 sm:px-6 lg:px-8 lg:pt-16 lg:pb-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
          {/* Left Copy Column */}
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="min-w-0 lg:col-span-6"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-lime-300">
              <span>Smoker&apos;s Lawn Care Service LLC</span>
              <span aria-hidden="true">·</span>
              <span>38-State Property Preservation Network</span>
            </div>

            <h1
              className="mt-4 font-display font-bold tracking-tight text-white"
              style={{
                fontSize: 'clamp(2.25rem, 4vw, 3.65rem)',
                lineHeight: 1.07,
                textWrap: 'balance'
              }}
            >
              Field preservation, lawn care &amp; REO repairs built for speed.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-lime-100/80">
              Partnering with mortgage field servicers, REO asset managers, property managers,
              landlords, and homeowners for HUD/FHA-compliant securing, debris trash-outs,
              bi-weekly turf maintenance, and turnkey handyman turns.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onEstimateClick}
                className="inline-flex items-center gap-2 rounded-lg bg-[#A3E635] px-5 py-3 text-sm font-bold text-[#052E16] hover:bg-[#BEF264] transition-colors cursor-pointer"
              >
                Get Instant Estimate
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={onRequestBidClick}
                className="inline-flex items-center gap-2 rounded-lg border border-lime-300/35 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                Submit Work Order
              </button>

              <a
                href="tel:+12173946440"
                className="inline-flex items-center gap-2 px-2 py-2.5 text-sm font-semibold text-lime-300 hover:underline"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                <span className="font-mono-tabular">(217) 394-6440</span>
              </a>
            </div>

            {/* Quiet Trust Row */}
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-lime-200/15 pt-5 text-xs text-lime-100/80">
              <span className="inline-flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                <strong className="font-mono-tabular text-white">{GOOGLE_PROFILE_INFO.rating}</strong>
                <span>Google Profile ({GOOGLE_PROFILE_INFO.reviewCount} reviews)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-lime-400" aria-hidden="true" />
                <span>HUD / FHA Mortgagee Compliant</span>
              </span>
            </div>
          </motion.div>

          {/* Right Photography Frame */}
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="min-w-0 lg:col-span-6"
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-lime-300/25 bg-emerald-900 shadow-2xl">
              {!imgError ? (
                <img
                  src={HERO_IMAGE}
                  alt="Freshly mowed striped residential lawn and preserved single-family property exterior"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-emerald-950 p-8 text-center text-lime-200">
                  <ShieldCheck className="h-10 w-10 text-lime-400" aria-hidden="true" />
                  <p className="mt-3 font-display text-lg font-semibold">
                    Smoker&apos;s Lawn Care Service LLC
                  </p>
                </div>
              )}

              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-5">
                <p className="text-xs font-medium text-lime-300">
                  MCS · Brookstone · SingleSource · Evernest Grade Field Operations
                </p>
                <p className="mt-0.5 font-display text-base font-semibold text-white">
                  GPS-verified lawn care, securing &amp; make-ready turns
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Vibrant Lime Surface Highlight Credential Bar */}
      <div className="bg-[#BEF264] text-[#052E16]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-y divide-[#052E16]/15 sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
          {CREDENTIAL_BAR.map((item) => (
            <div key={item.label} className="px-4 py-4 sm:px-6 lg:px-8">
              <p className="text-xs font-semibold opacity-75">{item.label}</p>
              <p className="mt-1 font-display text-lg font-bold font-mono-tabular sm:text-xl">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
