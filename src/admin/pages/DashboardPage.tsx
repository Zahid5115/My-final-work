import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  FileSpreadsheet,
  ShieldAlert,
  Users
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { HorizontalBarChart, MonthlyTrendChart } from '../components/SimpleCharts';
import { StatusBadge } from '../components/StatusBadge';
import type {
  ActivityLogEntity,
  BidRequestEntity,
  ClientRecord,
  DispatchRequestEntity,
  WorkOrderEntity
} from '../../types/platform';

interface DashboardResponse {
  metrics: {
    totalWorkOrders: number;
    openWorkOrders: number;
    newWorkOrders: number;
    inProgressWorkOrders: number;
    completedWorkOrders: number;
    qcVerifiedWorkOrders: number;
    urgentDispatchRequests: number;
    pendingBidRequests: number;
    totalVendors: number;
    pendingVendorApplications: number;
    activeClients: number;
    totalEstimatedValue: number;
    upcomingSlaDeadlines: number;
    overdueWorkOrders: number;
  };
  charts: {
    statusDistribution: Array<{ status: string; count: number }>;
    monthlyWorkOrders: Array<{ month: string; count: number; value: number }>;
    categoryBreakdown: Array<{ category: string; count: number }>;
    vendorPerformance: Array<{
      id: string;
      companyName: string;
      completedWorkOrders: number;
      activeAssigned: number;
      rating: number | null;
    }>;
  };
  lists: {
    recentActivity: ActivityLogEntity[];
    recentBidRequests: BidRequestEntity[];
    recentDispatchRequests: DispatchRequestEntity[];
    upcomingSlaDeadlines: WorkOrderEntity[];
    overdueWorkOrders: WorkOrderEntity[];
    recentClients: ClientRecord[];
  };
}

export const DashboardPage: React.FC = () => {
  const [range, setRange] = useState('30d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range });
      if (range === 'custom' && fromDate) {
        params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
      }
      const res = await apiRequest<DashboardResponse>(`/api/admin/dashboard?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  }, [range, fromDate, toDate]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const m = data?.metrics;

  const kpiCards = m
    ? [
        { label: 'Total Work Orders', value: m.totalWorkOrders, icon: ClipboardList, to: '/admin/work-orders' },
        { label: 'Open / Dispatched', value: m.openWorkOrders, icon: Clock, to: '/admin/work-orders' },
        { label: 'New Orders', value: m.newWorkOrders, icon: ClipboardList, to: '/admin/work-orders' },
        { label: 'In Progress', value: m.inProgressWorkOrders, icon: Clock, to: '/admin/work-orders' },
        { label: 'QC Verified', value: m.qcVerifiedWorkOrders, icon: CheckCircle2, to: '/admin/work-orders' },
        { label: 'Completed', value: m.completedWorkOrders, icon: CheckCircle2, to: '/admin/work-orders' },
        { label: 'Urgent Dispatches', value: m.urgentDispatchRequests, icon: ShieldAlert, to: '/admin/dispatch', alert: m.urgentDispatchRequests > 0 },
        { label: 'Pending Bid Requests', value: m.pendingBidRequests, icon: FileSpreadsheet, to: '/admin/bid-requests' },
        { label: 'Total Vendors', value: m.totalVendors, icon: Briefcase, to: '/admin/vendors' },
        { label: 'Pending Vendor Apps', value: m.pendingVendorApplications, icon: Briefcase, to: '/admin/vendors' },
        { label: 'Active Clients', value: m.activeClients, icon: Users, to: '/admin/clients' },
        { label: 'Est. Job Value', value: `$${m.totalEstimatedValue.toLocaleString()}`, icon: DollarSign, to: '/admin/reports' },
        { label: 'Upcoming SLAs (48h)', value: m.upcomingSlaDeadlines, icon: Calendar, to: '/admin/work-orders' },
        { label: 'Overdue Orders', value: m.overdueWorkOrders, icon: AlertTriangle, to: '/admin/work-orders', alert: m.overdueWorkOrders > 0 }
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Date Filter Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-950/12 bg-white p-4 dark:border-lime-300/20 dark:bg-[#072716] lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold">Executive Operations Overview</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Live metrics calculated directly from database records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'today', label: 'Today' },
            { id: '7d', label: 'Last 7 Days' },
            { id: '30d', label: 'Last 30 Days' },
            { id: '90d', label: 'Last 90 Days' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom' }
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                range === opt.id
                  ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                  : 'border border-emerald-950/15 bg-[#F6FAF1] text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#041A0E] dark:text-lime-100'
              }`}
            >
              {opt.label}
            </button>
          ))}

          {range === 'custom' && (
            <div className="flex items-center gap-1.5 pl-1">
              <input
                type="date"
                aria-label="From date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-emerald-950/20 bg-white px-2 py-1 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              />
              <span className="text-xs">to</span>
              <input
                type="date"
                aria-label="To date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-emerald-950/20 bg-white px-2 py-1 text-xs dark:border-lime-300/25 dark:bg-[#041A0E]"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs font-semibold text-red-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-white/70 dark:bg-[#072716]" />
          ))}
        </div>
      ) : (
        data && (
          <>
            {/* 14-Metric KPI Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
              {kpiCards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link
                    key={card.label}
                    to={card.to}
                    className={`rounded-xl border p-4 transition-colors hover:border-[#052E16]/40 dark:hover:border-lime-400/50 ${
                      card.alert
                        ? 'border-orange-300 bg-orange-50/70 dark:border-orange-400/40 dark:bg-orange-950/25'
                        : 'border-emerald-950/12 bg-white dark:border-lime-300/20 dark:bg-[#072716]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[#052E16]/70 dark:text-lime-200/75 truncate">
                        {card.label}
                      </span>
                      <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-800 dark:text-lime-400" />
                    </div>
                    <p className="mt-2 font-display text-2xl font-bold font-mono-tabular text-[#052E16] dark:text-lime-50">
                      {card.value}
                    </p>
                  </Link>
                );
              })}
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-4">
                <h3 className="font-display text-base font-bold">Monthly Work Orders</h3>
                <p className="text-[11px] text-[#052E16]/65 dark:text-lime-200/70">
                  Volume across selected range
                </p>
                <MonthlyTrendChart data={data.charts.monthlyWorkOrders} />
              </div>

              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-4">
                <h3 className="font-display text-base font-bold">Status Distribution</h3>
                <p className="mb-4 text-[11px] text-[#052E16]/65 dark:text-lime-200/70">
                  Current work order lifecycle breakdown
                </p>
                <HorizontalBarChart
                  items={data.charts.statusDistribution.map((s) => ({
                    label: s.status,
                    value: s.count
                  }))}
                />
              </div>

              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-4">
                <h3 className="font-display text-base font-bold">Service Category Breakdown</h3>
                <p className="mb-4 text-[11px] text-[#052E16]/65 dark:text-lime-200/70">
                  Orders grouped by capability pillar
                </p>
                <HorizontalBarChart
                  items={data.charts.categoryBreakdown.map((c) => ({
                    label: c.category,
                    value: c.count
                  }))}
                  accentClass="bg-emerald-700 dark:bg-lime-300"
                />
              </div>
            </div>

            {/* Operational Lists Row */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Upcoming SLA & Overdue */}
              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-bold">Upcoming &amp; Overdue SLAs</h3>
                  <Link to="/admin/work-orders" className="text-xs font-semibold text-emerald-800 hover:underline dark:text-lime-300">
                    View all orders &rarr;
                  </Link>
                </div>
                <div className="mt-4 divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                  {data.lists.overdueWorkOrders.length === 0 && data.lists.upcomingSlaDeadlines.length === 0 ? (
                    <p className="py-6 text-center text-xs opacity-65">No overdue or 48h upcoming SLA deadlines.</p>
                  ) : (
                    [...data.lists.overdueWorkOrders, ...data.lists.upcomingSlaDeadlines]
                      .slice(0, 6)
                      .map((wo) => (
                        <Link
                          key={wo.id}
                          to={`/admin/work-orders/${wo.id}`}
                          className="flex items-center justify-between gap-3 py-2.5 hover:bg-lime-100/50 dark:hover:bg-white/5 px-2 rounded"
                        >
                          <div className="min-w-0">
                            <p className="font-mono-tabular text-xs font-bold">{wo.workOrderCode}</p>
                            <p className="truncate text-xs opacity-75">
                              {wo.serviceDescription} · {wo.city}, {wo.state}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <StatusBadge value={wo.status} />
                            <p className="mt-0.5 text-[10px] opacity-70">
                              {wo.slaDeadline ? new Date(wo.slaDeadline).toLocaleDateString() : ''}
                            </p>
                          </div>
                        </Link>
                      ))
                  )}
                </div>
              </div>

              {/* Vendor Performance & Recent Clients */}
              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716] lg:col-span-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-bold">Approved Vendor Performance</h3>
                  <Link to="/admin/vendors" className="text-xs font-semibold text-emerald-800 hover:underline dark:text-lime-300">
                    Manage vendors &rarr;
                  </Link>
                </div>
                <div className="mt-4 divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                  {data.charts.vendorPerformance.length === 0 ? (
                    <p className="py-6 text-center text-xs opacity-65">No approved vendors yet.</p>
                  ) : (
                    data.charts.vendorPerformance.map((v) => (
                      <Link
                        key={v.id}
                        to={`/admin/vendors/${v.id}`}
                        className="flex items-center justify-between gap-3 py-2.5 px-2 rounded hover:bg-lime-100/50 dark:hover:bg-white/5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{v.companyName}</p>
                          <p className="text-[11px] opacity-75">
                            {v.activeAssigned} active assigned · {v.rating ? `${v.rating}★` : 'Unrated'}
                          </p>
                        </div>
                        <span className="font-mono-tabular text-xs font-bold text-emerald-800 dark:text-lime-300">
                          {v.completedWorkOrders} completed
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Recent Bid Requests, Dispatches, Clients & Audit Activity */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716]">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold">Recent Bid Requests</h3>
                  <Link to="/admin/bid-requests" className="text-[11px] font-semibold text-emerald-800 hover:underline dark:text-lime-300">
                    All &rarr;
                  </Link>
                </div>
                <div className="mt-3 space-y-2.5">
                  {data.lists.recentBidRequests.length === 0 ? (
                    <p className="py-4 text-xs opacity-65">No bid requests submitted yet.</p>
                  ) : (
                    data.lists.recentBidRequests.map((b) => (
                      <Link
                        key={b.id}
                        to={`/admin/bid-requests/${b.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-emerald-950/10 p-2.5 text-xs hover:bg-lime-100/40 dark:border-lime-300/15 dark:hover:bg-white/5"
                      >
                        <div className="min-w-0">
                          <p className="font-mono-tabular font-bold">{b.requestCode}</p>
                          <p className="truncate opacity-75">{b.contactName} · {b.propertyAddress}</p>
                        </div>
                        <StatusBadge value={b.status} />
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716]">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold">Recent Urgent Dispatches</h3>
                  <Link to="/admin/dispatch" className="text-[11px] font-semibold text-emerald-800 hover:underline dark:text-lime-300">
                    All &rarr;
                  </Link>
                </div>
                <div className="mt-3 space-y-2.5">
                  {data.lists.recentDispatchRequests.length === 0 ? (
                    <p className="py-4 text-xs opacity-65">No urgent dispatch tickets logged yet.</p>
                  ) : (
                    data.lists.recentDispatchRequests.map((d) => (
                      <Link
                        key={d.id}
                        to="/admin/dispatch"
                        className="flex items-center justify-between gap-2 rounded-lg border border-emerald-950/10 p-2.5 text-xs hover:bg-lime-100/40 dark:border-lime-300/15 dark:hover:bg-white/5"
                      >
                        <div className="min-w-0">
                          <p className="font-mono-tabular font-bold">{d.dispatchCode}</p>
                          <p className="truncate opacity-75">{d.emergencyType} · {d.propertyAddress}</p>
                        </div>
                        <StatusBadge value={d.status} />
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-950/12 bg-white p-5 dark:border-lime-300/20 dark:bg-[#072716]">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold">Recent Activity &amp; Clients</h3>
                  <Link to="/admin/clients" className="text-[11px] font-semibold text-emerald-800 hover:underline dark:text-lime-300">
                    Clients &rarr;
                  </Link>
                </div>
                <div className="mt-3 space-y-2">
                  {data.lists.recentActivity.length === 0 ? (
                    <p className="py-4 text-xs opacity-65">No recorded activity yet.</p>
                  ) : (
                    data.lists.recentActivity.slice(0, 5).map((log) => (
                      <div key={log.id} className="rounded-lg border border-emerald-950/10 p-2 text-[11px] dark:border-lime-300/15">
                        <p className="font-semibold">{log.summary}</p>
                        <p className="mt-0.5 opacity-65">
                          {log.actorEmail} · {new Date(log.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
};
