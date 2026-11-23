import React, { useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { ArrowUpRight, Check, ClipboardCheck, Hammer, ShieldAlert, Trees } from 'lucide-react';
import { CORE_SERVICES, type ServiceCategory } from '../data/servicesData';

const SERVICE_ICONS = [ShieldAlert, Trees, Hammer, ClipboardCheck];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08
    }
  }
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1]
    }
  }
};

export const ServicesSection: React.FC<{ services?: ServiceCategory[] }> = ({
  services = CORE_SERVICES
}) => {
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const shouldReduceMotion = useReducedMotion();
  const list = services.length > 0 ? services : CORE_SERVICES;
  const activeService = list[selectedIdx] ?? list[0];

  return (
    <section
      id="services"
      className="border-b border-emerald-950/10 bg-[#F6FAF1] dark:border-lime-300/15 dark:bg-[#03170C]"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-emerald-800 dark:text-lime-300">
              Core Capabilities
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#052E16] dark:text-lime-50 sm:text-4xl">
              Preservation, Lawn Care &amp; Handyman Scopes
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-[#052E16]/75 dark:text-lime-100/75">
            Click any capability pillar to inspect itemized line scopes, SLA windows, and HUD/FHA
            documentation standards.
          </p>
        </div>

        <motion.div
          variants={shouldReduceMotion ? undefined : containerVariants}
          initial={shouldReduceMotion ? false : 'hidden'}
          whileInView={shouldReduceMotion ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.15 }}
          className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12"
        >
          {/* Left 4-Card Selectable Matrix */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-6 lg:grid-cols-1">
            {list.map((service, idx) => {
              const Icon = SERVICE_ICONS[idx % SERVICE_ICONS.length] ?? ShieldAlert;
              const isSelected = idx === selectedIdx;
              return (
                <motion.button
                  key={service.number}
                  type="button"
                  variants={shouldReduceMotion ? undefined : cardVariants}
                  onClick={() => setSelectedIdx(idx)}
                  className={`flex items-center justify-between gap-4 rounded-xl border p-5 text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#052E16] bg-[#BEF264] text-[#052E16] shadow-sm dark:border-lime-400 dark:bg-lime-400 dark:text-[#052E16]'
                      : 'border-emerald-950/12 bg-white text-[#052E16] hover:border-emerald-950/30 dark:border-lime-300/15 dark:bg-[#072716] dark:text-lime-100 dark:hover:border-lime-400/40'
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                        isSelected
                          ? 'bg-[#052E16] text-[#BEF264]'
                          : 'bg-lime-100 text-[#052E16] dark:bg-[#0D3D23] dark:text-lime-300'
                      }`}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono-tabular text-xs font-semibold opacity-75">
                        {service.number} · {service.turnaround}
                      </p>
                      <h3 className="font-display text-base sm:text-lg font-bold truncate">
                        {service.title}
                      </h3>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </motion.button>
              );
            })}
          </div>

          {/* Right Active Scope Detail Workbench */}
          <motion.div
            key={activeService.number}
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col justify-between rounded-2xl border border-emerald-950/12 bg-white p-6 sm:p-8 shadow-sm dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-6"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-emerald-800 dark:text-lime-300">
                <span>{activeService.number} Active Scope Breakdown</span>
                <span className="font-mono-tabular">{activeService.turnaround}</span>
              </div>

              <h3 className="mt-3 font-display text-2xl font-bold text-[#052E16] dark:text-lime-50">
                {activeService.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#052E16]/80 dark:text-lime-100/80">
                {activeService.subtitle}
              </p>

              <ul className="mt-6 space-y-3 border-t border-emerald-950/10 pt-5 dark:border-lime-300/15">
                {activeService.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-sm text-[#052E16] dark:text-lime-100"
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-lime-400"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-emerald-950/10 pt-4 text-xs dark:border-lime-300/15">
              <span className="font-medium text-emerald-900/75 dark:text-lime-300/85">
                {activeService.complianceNote}
              </span>
              <a
                href="#estimator"
                className="font-semibold text-[#052E16] underline underline-offset-4 hover:text-emerald-700 dark:text-lime-300"
              >
                Estimate this scope &rarr;
              </a>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};
