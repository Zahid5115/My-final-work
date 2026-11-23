import React, { useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { Camera, SlidersHorizontal } from 'lucide-react';
import { BEFORE_AFTER_CASES, type BeforeAfterCase } from '../data/servicesData';

const galleryVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: [0.16, 1, 0.3, 1]
    }
  }
};

export const BeforeAfterGallery: React.FC<{ cases?: BeforeAfterCase[] }> = ({
  cases = BEFORE_AFTER_CASES
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sliderPercent, setSliderPercent] = useState(50);
  const [imgErr, setImgErr] = useState<{ before?: boolean; after?: boolean }>({});
  const shouldReduceMotion = useReducedMotion();

  const list = cases.length > 0 ? cases : BEFORE_AFTER_CASES;
  const currentCase = list[selectedIdx] ?? list[0];

  return (
    <section
      id="gallery"
      className="bg-[#052E16] text-lime-50 dark:bg-[#021209]"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-lime-300">
              Verified Field Results
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Before &amp; After Transformation Showcase
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            {list.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedIdx(idx);
                  setSliderPercent(50);
                  setImgErr({});
                }}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  selectedIdx === idx
                    ? 'bg-[#BEF264] text-[#052E16]'
                    : 'border border-lime-300/25 text-lime-100 hover:bg-white/10'
                }`}
              >
                {idx === 0
                  ? '01. Exterior Preservation'
                  : idx === 1
                    ? '02. Interior REO Rehab'
                    : `${String(idx + 1).padStart(2, '0')}. ${item.title.slice(0, 24)}`}
              </button>
            ))}
          </div>
        </div>

        <motion.div
          variants={shouldReduceMotion ? undefined : galleryVariants}
          initial={shouldReduceMotion ? false : 'hidden'}
          whileInView={shouldReduceMotion ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.15 }}
          className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center"
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-lime-300/25 bg-black select-none min-w-0 lg:col-span-7">
            {!imgErr.after ? (
              <img
                src={currentCase.afterImage}
                alt={currentCase.afterAlt}
                referrerPolicy="no-referrer"
                onError={() => setImgErr((prev) => ({ ...prev, after: true }))}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-emerald-950 text-lime-200">
                <Camera className="h-8 w-8" />
              </div>
            )}

            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }}
            >
              {!imgErr.before ? (
                <img
                  src={currentCase.beforeImage}
                  alt={currentCase.beforeAlt}
                  referrerPolicy="no-referrer"
                  onError={() => setImgErr((prev) => ({ ...prev, before: true }))}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-800 text-slate-300">
                  <Camera className="h-8 w-8" />
                </div>
              )}
            </div>

            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
              style={{ left: `${sliderPercent}%` }}
            >
              <div className="absolute top-1/2 -left-4 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#052E16] shadow-md">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
            </div>

            <input
              type="range"
              min={5}
              max={95}
              value={sliderPercent}
              onChange={(e) => setSliderPercent(Number(e.target.value))}
              aria-label={`Compare before and after photos for ${currentCase.title}`}
              className="absolute inset-0 z-10 h-full w-full cursor-ew-resize opacity-0"
            />

            <span className="pointer-events-none absolute top-3 left-3 rounded bg-black/75 px-2.5 py-1 text-xs font-semibold text-white">
              Before
            </span>
            <span className="pointer-events-none absolute top-3 right-3 rounded bg-[#BEF264] px-2.5 py-1 text-xs font-bold text-[#052E16]">
              After
            </span>
          </div>

          <div className="flex flex-col justify-between space-y-6 min-w-0 lg:col-span-5">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-lime-300 font-mono-tabular">
                <span>{currentCase.workOrderId}</span>
                <span aria-hidden="true">·</span>
                <span>{currentCase.location}</span>
              </div>
              <h3 className="mt-2 font-display text-2xl font-bold text-white">
                {currentCase.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-lime-100/80">
                {currentCase.scopeSummary}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-4 border-y border-lime-200/15 py-5">
              <div>
                <dt className="text-xs font-medium text-lime-200/70">Completion Window</dt>
                <dd className="mt-1 font-display text-2xl font-bold font-mono-tabular text-[#BEF264]">
                  {currentCase.turnaroundHours} Hours
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-lime-200/70">Audit Status</dt>
                <dd className="mt-1 font-display text-2xl font-bold text-white">HUD Passed</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSliderPercent(92)}
                className="rounded-lg border border-lime-300/30 px-3.5 py-2 text-xs font-semibold text-lime-100 hover:bg-white/10 cursor-pointer"
              >
                Full Before
              </button>
              <button
                type="button"
                onClick={() => setSliderPercent(50)}
                className="rounded-lg border border-lime-300/30 px-3.5 py-2 text-xs font-semibold text-lime-100 hover:bg-white/10 cursor-pointer"
              >
                50/50 Split
              </button>
              <button
                type="button"
                onClick={() => setSliderPercent(8)}
                className="rounded-lg bg-[#BEF264] px-3.5 py-2 text-xs font-bold text-[#052E16] hover:bg-lime-200 cursor-pointer"
              >
                Full After
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
