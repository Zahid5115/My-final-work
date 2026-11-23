import React, { useMemo, useState } from 'react';
import { ArrowRight, Calculator, CheckCircle2 } from 'lucide-react';

export type EstimatorCategory = 'lawn' | 'debris' | 'handyman' | 'winterization';

export interface EstimatePayload {
  categoryLabel: string;
  summary: string;
  lowEstimate: number;
  highEstimate: number;
}

interface QuoteEstimatorProps {
  onApplyEstimate: (payload: EstimatePayload) => void;
}

const CATEGORY_TABS: { id: EstimatorCategory; label: string }[] = [
  { id: 'lawn', label: 'Lawn Care' },
  { id: 'debris', label: 'Debris Removal' },
  { id: 'handyman', label: 'Handyman' },
  { id: 'winterization', label: 'Winterization' }
];

export const QuoteEstimator: React.FC<QuoteEstimatorProps> = ({ onApplyEstimate }) => {
  const [category, setCategory] = useState<EstimatorCategory>('lawn');

  const [lotSqFt, setLotSqFt] = useState<number>(8500);
  const [overgrown, setOvergrown] = useState<boolean>(false);
  const [shrubTrim, setShrubTrim] = useState<boolean>(true);

  const [cubicYards, setCubicYards] = useState<number>(10);
  const [heavyAppliances, setHeavyAppliances] = useState<boolean>(false);

  const [laborHours, setLaborHours] = useState<number>(4);
  const [tradeTier, setTradeTier] = useState<'general' | 'plumbing_elec' | 'lock_board'>('general');

  const [propertyUnits, setPropertyUnits] = useState<'single' | 'duplex' | 'multi'>('single');
  const [heatingType, setHeatingType] = useState<'forced_air' | 'boiler_radiant'>('forced_air');
  const [includeLockChange, setIncludeLockChange] = useState<boolean>(true);

  const calculation = useMemo(() => {
    if (category === 'lawn') {
      const baseCut = Math.round(55 + (lotSqFt / 1000) * 6.5);
      const overgrownFee = overgrown ? Math.round(baseCut * 0.65) : 0;
      const shrubFee = shrubTrim ? 65 : 0;
      const subtotal = baseCut + overgrownFee + shrubFee;
      return {
        categoryLabel: 'Lawn Care & Grounds Maintenance',
        hudCode: 'HUD Grass Cut & Curb Abatement',
        summary: `${lotSqFt.toLocaleString()} sq ft lot${overgrown ? ', overgrown >12" cut' : ', standard cut'}${shrubTrim ? ', shrub & edge trim' : ''}`,
        low: Math.round(subtotal * 0.92),
        high: Math.round(subtotal * 1.12),
        breakdown: [
          { label: `Base turf cut (${lotSqFt.toLocaleString()} sq ft)`, amount: baseCut },
          ...(overgrown ? [{ label: 'Overgrown (>12") double-pass', amount: overgrownFee }] : []),
          ...(shrubTrim ? [{ label: 'Shrub pruning & concrete edging', amount: shrubFee }] : [])
        ]
      };
    }

    if (category === 'debris') {
      const haulCost = cubicYards * 52;
      const dumpFee = Math.round(65 + cubicYards * 14);
      const applianceFee = heavyAppliances ? 160 : 0;
      const subtotal = haulCost + dumpFee + applianceFee;
      return {
        categoryLabel: 'Debris Removal & Trash-Out',
        hudCode: 'HUD Interior/Exterior Debris Haul',
        summary: `${cubicYards} cubic yards haul-out${heavyAppliances ? ' + bulk appliance disposal' : ''}`,
        low: Math.round(subtotal * 0.9),
        high: Math.round(subtotal * 1.14),
        breakdown: [
          { label: `Crew loading & hauling (${cubicYards} cu yds)`, amount: haulCost },
          { label: 'Landfill transfer & disposal fees', amount: dumpFee },
          ...(heavyAppliances ? [{ label: 'Heavy appliance / tire disposal', amount: applianceFee }] : [])
        ]
      };
    }

    if (category === 'handyman') {
      const hourlyRate = tradeTier === 'plumbing_elec' ? 98 : tradeTier === 'lock_board' ? 88 : 78;
      const labor = laborHours * hourlyRate;
      const dispatchMaterials = tradeTier === 'lock_board' ? 95 : 55;
      const subtotal = labor + dispatchMaterials;
      const tierLabel =
        tradeTier === 'plumbing_elec'
          ? 'Plumbing / Electrical Troubleshooting'
          : tradeTier === 'lock_board'
            ? 'Lock Re-Key & Boarding Crew'
            : 'Drywall, Paint & Finish Carpentry';
      return {
        categoryLabel: 'Handyman & REO Repairs',
        hudCode: 'RepairBase / Turnkey Scope',
        summary: `${laborHours} labor hrs — ${tierLabel}`,
        low: Math.round(subtotal * 0.9),
        high: Math.round(subtotal * 1.15),
        breakdown: [
          { label: `${tierLabel} (${laborHours} hrs @ $${hourlyRate}/hr)`, amount: labor },
          { label: 'Trip charge & baseline materials', amount: dispatchMaterials }
        ]
      };
    }

    const unitBase = propertyUnits === 'single' ? 195 : propertyUnits === 'duplex' ? 285 : 390;
    const radiantFee = heatingType === 'boiler_radiant' ? 115 : 0;
    const lockFee = includeLockChange ? 85 : 0;
    const subtotal = unitBase + radiantFee + lockFee;
    return {
      categoryLabel: 'Winterization & Securing',
      hudCode: 'HUD Pressure-Test & Antifreeze Tagging',
      summary: `${propertyUnits === 'single' ? 'Single-family' : propertyUnits === 'duplex' ? 'Duplex' : 'Multi-unit'}, ${heatingType === 'boiler_radiant' ? 'Hydronic/Boiler' : 'Forced Air'}${includeLockChange ? ' + Primary Lock Change' : ''}`,
      low: Math.round(subtotal * 0.95),
      high: Math.round(subtotal * 1.1),
      breakdown: [
        { label: `Air-compressor drain & antifreeze (${propertyUnits})`, amount: unitBase },
        ...(radiantFee > 0 ? [{ label: 'Hydronic boiler line purge', amount: radiantFee }] : []),
        ...(lockFee > 0 ? [{ label: 'HUD keycode deadbolt & lockbox', amount: lockFee }] : [])
      ]
    };
  }, [
    category,
    lotSqFt,
    overgrown,
    shrubTrim,
    cubicYards,
    heavyAppliances,
    laborHours,
    tradeTier,
    propertyUnits,
    heatingType,
    includeLockChange
  ]);

  return (
    <section
      id="estimator"
      className="border-b border-emerald-950/10 bg-white dark:border-lime-300/15 dark:bg-[#052312]"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="flex flex-col gap-4 border-b border-emerald-950/10 pb-6 dark:border-lime-300/15 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-emerald-800 dark:text-lime-300">
              <Calculator className="h-4 w-4" aria-hidden="true" />
              Cost &amp; Scope Estimator
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#052E16] dark:text-lime-50 sm:text-4xl">
              Interactive Service Quote Calculator
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Service Category Estimator Tabs"
            className="flex flex-wrap gap-1.5"
          >
            {CATEGORY_TABS.map((tab) => {
              const active = category === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(tab.id)}
                  className={`rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                      : 'border border-emerald-950/15 bg-[#F6FAF1] text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#082E18] dark:text-lime-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
          {/* Left Controls */}
          <div className="space-y-6 min-w-0 lg:col-span-7">
            {category === 'lawn' && (
              <>
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="lot-size-range"
                      className="text-sm font-semibold text-[#052E16] dark:text-lime-100"
                    >
                      Estimated Lot Size
                    </label>
                    <span className="font-mono-tabular text-sm font-bold text-emerald-800 dark:text-lime-300">
                      {lotSqFt.toLocaleString()} sq ft ({(lotSqFt / 43560).toFixed(2)} acres)
                    </span>
                  </div>
                  <input
                    id="lot-size-range"
                    type="range"
                    min={2500}
                    max={45000}
                    step={500}
                    value={lotSqFt}
                    onChange={(e) => setLotSqFt(Number(e.target.value))}
                    className="mt-3 h-2 w-full cursor-pointer accent-[#052E16] dark:accent-lime-400"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-950/12 bg-[#F6FAF1] p-4 dark:border-lime-300/15 dark:bg-[#072716]">
                    <input
                      type="checkbox"
                      checked={overgrown}
                      onChange={(e) => setOvergrown(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-[#052E16] dark:accent-lime-400"
                    />
                    <div>
                      <span className="block text-sm font-semibold text-[#052E16] dark:text-lime-50">
                        Overgrown Turf (&gt; 12&quot;)
                      </span>
                      <span className="text-xs text-[#052E16]/75 dark:text-lime-200/75">
                        Initial brush clearing &amp; double-pass mulch
                      </span>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-950/12 bg-[#F6FAF1] p-4 dark:border-lime-300/15 dark:bg-[#072716]">
                    <input
                      type="checkbox"
                      checked={shrubTrim}
                      onChange={(e) => setShrubTrim(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-[#052E16] dark:accent-lime-400"
                    />
                    <div>
                      <span className="block text-sm font-semibold text-[#052E16] dark:text-lime-50">
                        Shrub &amp; Walkway Edging
                      </span>
                      <span className="text-xs text-[#052E16]/75 dark:text-lime-200/75">
                        Hedge shaping, concrete edge, and blow-off
                      </span>
                    </div>
                  </label>
                </div>
              </>
            )}

            {category === 'debris' && (
              <>
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="cubic-yards-range"
                      className="text-sm font-semibold text-[#052E16] dark:text-lime-100"
                    >
                      Estimated Debris Volume
                    </label>
                    <span className="font-mono-tabular text-sm font-bold text-emerald-800 dark:text-lime-300">
                      {cubicYards} Cubic Yards
                    </span>
                  </div>
                  <input
                    id="cubic-yards-range"
                    type="range"
                    min={2}
                    max={40}
                    step={1}
                    value={cubicYards}
                    onChange={(e) => setCubicYards(Number(e.target.value))}
                    className="mt-3 h-2 w-full cursor-pointer accent-[#052E16] dark:accent-lime-400"
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-950/12 bg-[#F6FAF1] p-4 dark:border-lime-300/15 dark:bg-[#072716]">
                  <input
                    type="checkbox"
                    checked={heavyAppliances}
                    onChange={(e) => setHeavyAppliances(e.target.checked)}
                    className="mt-1 h-4 w-4 accent-[#052E16] dark:accent-lime-400"
                  />
                  <div>
                    <span className="block text-sm font-semibold text-[#052E16] dark:text-lime-50">
                      Include Heavy Appliances / Refrigerant Units
                    </span>
                    <span className="text-xs text-[#052E16]/75 dark:text-lime-200/75">
                      Refrigerators, water heaters, tires, or bulk furniture manifest
                    </span>
                  </div>
                </label>
              </>
            )}

            {category === 'handyman' && (
              <>
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="labor-hours-range"
                      className="text-sm font-semibold text-[#052E16] dark:text-lime-100"
                    >
                      Estimated Technician Labor Hours
                    </label>
                    <span className="font-mono-tabular text-sm font-bold text-emerald-800 dark:text-lime-300">
                      {laborHours} {laborHours === 1 ? 'Hour' : 'Hours'}
                    </span>
                  </div>
                  <input
                    id="labor-hours-range"
                    type="range"
                    min={1}
                    max={24}
                    step={1}
                    value={laborHours}
                    onChange={(e) => setLaborHours(Number(e.target.value))}
                    className="mt-3 h-2 w-full cursor-pointer accent-[#052E16] dark:accent-lime-400"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    { id: 'general', title: 'Drywall & Carpentry', desc: '$78/hr · Patch & paint' },
                    { id: 'lock_board', title: 'Lock & Board-Up', desc: '$88/hr · Securing crew' },
                    { id: 'plumbing_elec', title: 'Plumbing / Electrical', desc: '$98/hr · Licensed tech' }
                  ].map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() =>
                        setTradeTier(tier.id as 'general' | 'plumbing_elec' | 'lock_board')
                      }
                      className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                        tradeTier === tier.id
                          ? 'border-[#052E16] bg-[#052E16] text-[#BEF264] dark:border-lime-400 dark:bg-lime-400 dark:text-[#052E16]'
                          : 'border-emerald-950/15 bg-[#F6FAF1] text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
                      }`}
                    >
                      <span className="block text-sm font-bold">{tier.title}</span>
                      <span className="mt-0.5 block text-xs opacity-80">{tier.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {category === 'winterization' && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    { id: 'single', label: 'Single-Family', note: 'Up to 2.5 baths' },
                    { id: 'duplex', label: 'Duplex / Townhome', note: '2 separate meters' },
                    { id: 'multi', label: 'Multi-Unit (3–4)', note: 'Full manifold purge' }
                  ].map((unit) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() =>
                        setPropertyUnits(unit.id as 'single' | 'duplex' | 'multi')
                      }
                      className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                        propertyUnits === unit.id
                          ? 'border-[#052E16] bg-[#052E16] text-[#BEF264] dark:border-lime-400 dark:bg-lime-400 dark:text-[#052E16]'
                          : 'border-emerald-950/15 bg-[#F6FAF1] text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
                      }`}
                    >
                      <span className="block text-sm font-bold">{unit.label}</span>
                      <span className="mt-0.5 block text-xs opacity-80">{unit.note}</span>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setHeatingType((prev) =>
                        prev === 'forced_air' ? 'boiler_radiant' : 'forced_air'
                      )
                    }
                    className="rounded-xl border border-emerald-950/15 bg-[#F6FAF1] p-4 text-left text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100 cursor-pointer"
                  >
                    <span className="block text-sm font-semibold">
                      System: {heatingType === 'forced_air' ? 'Forced Air HVAC' : 'Hydronic / Boiler'}
                    </span>
                    <span className="text-xs opacity-75">Click to switch heating type</span>
                  </button>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-950/15 bg-[#F6FAF1] p-4 dark:border-lime-300/20 dark:bg-[#072716]">
                    <input
                      type="checkbox"
                      checked={includeLockChange}
                      onChange={(e) => setIncludeLockChange(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-[#052E16] dark:accent-lime-400"
                    />
                    <div>
                      <span className="block text-sm font-semibold text-[#052E16] dark:text-lime-50">
                        Add Primary Lock Re-Key
                      </span>
                      <span className="text-xs text-[#052E16]/75 dark:text-lime-200/75">
                        HUD keycode deadbolt &amp; lockbox
                      </span>
                    </div>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* Right Vibrant Lime Receipt Card with Deep Forest Text */}
          <div className="rounded-2xl bg-[#BEF264] p-6 text-[#052E16] shadow-sm min-w-0 sm:p-8 lg:col-span-5">
            <div className="flex items-center justify-between text-xs font-semibold opacity-80">
              <span>Estimated Price Range</span>
              <span className="font-mono-tabular">{calculation.hudCode}</span>
            </div>

            <div className="mt-3 font-display text-4xl font-bold tracking-tight font-mono-tabular">
              ${calculation.low.toLocaleString()} – ${calculation.high.toLocaleString()}
            </div>
            <p className="mt-2 text-xs font-medium opacity-85">{calculation.summary}</p>

            <ul className="mt-6 space-y-2.5 border-t border-[#052E16]/15 pt-4 text-sm">
              {calculation.breakdown.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{row.label}</span>
                  </span>
                  <span className="font-mono-tabular font-bold">
                    ${row.amount.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() =>
                onApplyEstimate({
                  categoryLabel: calculation.categoryLabel,
                  summary: calculation.summary,
                  lowEstimate: calculation.low,
                  highEstimate: calculation.high
                })
              }
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#052E16] px-5 py-3 text-sm font-bold text-[#BEF264] hover:bg-[#094724] transition-colors cursor-pointer"
            >
              Lock In Estimate &amp; Request Bid
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
