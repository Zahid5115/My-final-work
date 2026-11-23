import React, { useMemo, useState } from 'react';
import { FileText, Globe2, MapPin, Search } from 'lucide-react';
import {
  COVERAGE_REGIONS,
  SAMPLE_WORK_ORDERS,
  type CoverageRegion,
  type WorkOrderRecord
} from '../data/servicesData';
import { ServiceCoverageMap } from './ServiceCoverageMap';

const STATUS_FILTERS: Array<'All' | WorkOrderRecord['status']> = [
  'All',
  'Open Bid',
  'Dispatched',
  'In Progress',
  'QC Verified'
];

interface WorkOrdersAndCoverageProps {
  isDark: boolean;
  workOrders?: WorkOrderRecord[];
  coverageRegions?: CoverageRegion[];
}

export const WorkOrdersAndCoverage: React.FC<WorkOrdersAndCoverageProps> = ({
  isDark,
  workOrders = SAMPLE_WORK_ORDERS,
  coverageRegions = COVERAGE_REGIONS
}) => {
  const [statusFilter, setStatusFilter] = useState<'All' | WorkOrderRecord['status']>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRegionIdx, setActiveRegionIdx] = useState(0);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrderRecord | null>(null);

  const regionList = coverageRegions.length > 0 ? coverageRegions : COVERAGE_REGIONS;

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return workOrders.filter((order) => {
      const matchesStatus = statusFilter === 'All' || order.status === statusFilter;
      const matchesQuery =
        !q ||
        order.id.toLowerCase().includes(q) ||
        order.cityState.toLowerCase().includes(q) ||
        order.serviceType.toLowerCase().includes(q) ||
        order.county.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [workOrders, statusFilter, searchQuery]);

  const activeRegion = regionList[activeRegionIdx] ?? regionList[0];

  const handleSelectRegion = (idx: number) => {
    setSelectedWorkOrder(null);
    setActiveRegionIdx(idx);
  };

  return (
    <section
      id="work-orders"
      className="border-b border-emerald-950/10 bg-[#F6FAF1] dark:border-lime-300/15 dark:bg-[#03170C]"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-emerald-800 dark:text-lime-300">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Work Orders &amp; Regional Dispatch
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#052E16] dark:text-lime-50 sm:text-4xl">
              Work Order Operations &amp; U.S. Coverage
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-[#052E16]/75 dark:text-lime-100/75">
            Institutional SLA tracking modeled on MCS, Brookstone, SingleSource, and Evernest
            standards across 1,099+ active counties.
          </p>
        </div>

        {/* Hairline 4-Step Lifecycle */}
        <div className="mt-10 grid grid-cols-1 divide-y divide-emerald-950/12 border-y border-emerald-950/12 dark:divide-lime-300/15 dark:border-lime-300/15 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          {[
            { step: '01. Dispatch Intake', desc: 'Property keys, occupancy status & HUD SLA logged.' },
            { step: '02. Field Execution', desc: 'Background-checked crew completes preservation or turn.' },
            { step: '03. GPS Photo Audit', desc: 'Before/during/after date-stamped photo sets uploaded.' },
            { step: '04. QC & Settlement', desc: 'In-house quality review before Net-15 invoice release.' }
          ].map((item) => (
            <div key={item.step} className="py-5 sm:px-5 first:sm:pl-0 last:sm:pr-0">
              <h3 className="font-display text-sm font-bold text-[#052E16] dark:text-lime-200">
                {item.step}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[#052E16]/75 dark:text-lime-100/75">
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Active Work Orders Table (min-w-0 prevents horizontal overflow) */}
          <div className="min-w-0 lg:col-span-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-display text-xl font-bold text-[#052E16] dark:text-lime-50">
                Active Work Order Queue
              </h3>
              <div className="relative w-full sm:w-56">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#052E16]/50 dark:text-lime-300/60"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search WO# or city..."
                  aria-label="Search work orders by ID, city, or scope"
                  className="w-full rounded-lg border border-emerald-950/15 bg-white py-1.5 pr-3 pl-9 text-xs text-[#052E16] placeholder:text-[#052E16]/50 focus:border-[#052E16] focus:outline-none dark:border-lime-300/25 dark:bg-[#072716] dark:text-lime-100 dark:placeholder:text-lime-200/50"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    statusFilter === status
                      ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                      : 'border border-emerald-950/15 bg-white text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-950/12 bg-white dark:border-lime-300/20 dark:bg-[#072716]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-emerald-950/12 text-[#052E16]/70 dark:border-lime-300/15 dark:text-lime-300/80">
                  <tr>
                    <th className="px-4 py-3 font-semibold">WO #</th>
                    <th className="px-4 py-3 font-semibold">Scope &amp; Location</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[#052E16]/70 dark:text-lime-200/75">
                        No matching work orders found.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((wo) => {
                      const isSelected = selectedWorkOrder?.id === wo.id;
                      return (
                        <tr
                          key={wo.id}
                          tabIndex={0}
                          onClick={() => setSelectedWorkOrder(isSelected ? null : wo)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedWorkOrder(isSelected ? null : wo);
                            }
                          }}
                          aria-selected={isSelected}
                          className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#052E16] dark:focus-visible:ring-lime-300 ${
                            isSelected
                              ? 'bg-lime-100/80 text-[#052E16] dark:bg-lime-400/15 dark:text-lime-50'
                              : 'text-[#052E16] hover:bg-emerald-950/[0.03] dark:text-lime-100 dark:hover:bg-lime-300/[0.06]'
                          }`}
                        >
                          <td className="px-4 py-3.5 align-top font-mono-tabular font-semibold whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin
                                className={`h-3.5 w-3.5 shrink-0 ${
                                  isSelected
                                    ? 'text-orange-600 dark:text-lime-300'
                                    : 'text-emerald-700/60 dark:text-lime-300/50'
                                }`}
                                aria-hidden="true"
                              />
                              {wo.id}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="font-semibold">{wo.serviceType}</p>
                            <p className="mt-0.5 opacity-75">
                              {wo.clientType} · {wo.cityState} ({wo.county} Co.)
                            </p>
                          </td>
                          <td className="px-4 py-3.5 align-top whitespace-nowrap">
                            <span className="font-semibold">{wo.status}</span>
                            <p className="mt-0.5 opacity-70">{wo.slaDue}</p>
                          </td>
                          <td className="px-4 py-3.5 text-right align-top font-mono-tabular font-semibold whitespace-nowrap">
                            ${wo.estimatedBudget}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2.5 text-xs text-[#052E16]/65 dark:text-lime-200/70">
              Select any work order row to locate its dispatch pin on the coverage map.
            </p>
          </div>

          {/* Interactive Regional Hub Selector + Google Maps Coverage */}
          <div className="min-w-0 lg:col-span-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Globe2 className="h-5 w-5 text-[#052E16] dark:text-lime-300" aria-hidden="true" />
                <h3 className="font-display text-xl font-bold text-[#052E16] dark:text-lime-50">
                  U.S. Regional Operations Map
                </h3>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {regionList.map((region, idx) => (
                <button
                  key={region.region}
                  type="button"
                  onClick={() => handleSelectRegion(idx)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    !selectedWorkOrder && activeRegionIdx === idx
                      ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                      : 'border border-emerald-950/15 bg-white text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
                  }`}
                >
                  {region.region.split(' ')[0]}
                </button>
              ))}
            </div>

            <div className="mt-4">
              <ServiceCoverageMap
                regions={regionList}
                workOrders={filteredOrders}
                activeRegionIdx={activeRegionIdx}
                selectedWorkOrder={selectedWorkOrder}
                onSelectRegion={handleSelectRegion}
                onSelectWorkOrder={setSelectedWorkOrder}
                isDark={isDark}
              />
            </div>

            <div className="mt-4 rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-emerald-800 dark:text-lime-300">
                    Regional Hub: {activeRegion.hubCity}
                    {activeRegion.isHeadquarters ? ' (National HQ)' : ''}
                  </p>
                  <h4 className="mt-0.5 font-display text-xl font-bold text-[#052E16] dark:text-lime-50">
                    {activeRegion.region}
                  </h4>
                </div>
                <div className="flex items-center gap-5 text-right">
                  <div>
                    <p className="text-[11px] text-[#052E16]/70 dark:text-lime-200/75">Counties</p>
                    <p className="font-display text-lg font-bold font-mono-tabular text-[#052E16] dark:text-lime-100">
                      {activeRegion.activeCounties}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#052E16]/70 dark:text-lime-200/75">Avg SLA</p>
                    <p className="font-display text-lg font-bold font-mono-tabular text-[#052E16] dark:text-lime-100">
                      {activeRegion.avgDispatchHours} Hrs
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3 space-y-1 border-t border-emerald-950/10 pt-3 text-xs text-[#052E16]/85 dark:border-lime-300/15 dark:text-lime-100/85">
                <p>
                  <strong>States Covered:</strong> {activeRegion.states.join(', ')}
                </p>
                <p>
                  <strong>Compliance Protocol:</strong> {activeRegion.hudStandard}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
