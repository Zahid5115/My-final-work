import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiRequest, getInMemoryAuthToken } from '../../services/api';
import { HorizontalBarChart } from '../components/SimpleCharts';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';

interface ReportsResponse {
  summary: {
    workOrdersCount: number;
    completionRate: number;
    slaComplianceCount: number;
    bidRequestsCount: number;
    bidConversionRate: number;
    dispatchesCount: number;
    resolvedDispatches: number;
    totalJobValue: number;
    activeClientsCount: number;
    approvedVendorsCount: number;
  };
  serviceReport: Array<{ category: string; count: number; totalBudget: number }>;
  vendorReport: Array<{
    id: string;
    vendorCode: string;
    companyName: string;
    applicationStatus: string;
    completedWorkOrders: number;
    assignedActive: number;
    rating: number | null;
  }>;
  clientReport: Array<{
    id: string;
    clientCode: string;
    name: string;
    clientType: string;
    workOrdersCount: number;
    totalBudget: number;
  }>;
}

export const ReportsAdminPage: React.FC = () => {
  const { hasPermission } = useAdminAuth();
  const [range, setRange] = useState('all');
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<ReportsResponse>(`/api/admin/reports?range=${range}`);
      setData(res);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load reports.' });
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleExportCsv = async (type: 'work-orders' | 'vendors' | 'bid-requests' | 'dispatch') => {
    try {
      const token = getInMemoryAuthToken();
      const res = await fetch(`/api/admin/reports/export?type=${type}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Export failed.');
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `slc-${type}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ type: 'success', text: `Exported slc-${type}-report.csv.` });
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Export failed.' });
    }
  };

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">Operational Analytics &amp; CSV Exports</h2>
          <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
            Track completion rates, SLA adherence, vendor workload, client volume, and export spreadsheet reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['today', '7d', '30d', '90d', 'all'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase cursor-pointer ${
                range === r
                  ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                  : 'border border-emerald-950/15 bg-white text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
              }`}
            >
              {r === 'all' ? 'All Time' : r}
            </button>
          ))}
        </div>
      </div>

      {hasPermission('reports.export') && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
          <span className="text-xs font-bold mr-2">Export CSV:</span>
          {(['work-orders', 'vendors', 'bid-requests', 'dispatch'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => void handleExportCsv(type)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-1.5 text-xs font-semibold hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#03170C] cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              {type}
            </button>
          ))}
        </div>
      )}

      {loading || !data ? (
        <div className="py-12 text-center text-xs">Loading analytics...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: 'Work Orders', value: data.summary.workOrdersCount },
              { label: 'Completion Rate', value: `${data.summary.completionRate}%` },
              { label: 'Bid Conversion', value: `${data.summary.bidConversionRate}%` },
              { label: 'Dispatches Resolved', value: `${data.summary.resolvedDispatches}/${data.summary.dispatchesCount}` },
              { label: 'Total Job Value', value: `$${data.summary.totalJobValue.toLocaleString()}` }
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]"
              >
                <p className="text-[11px] font-semibold text-[#052E16]/65 dark:text-lime-200/70">{card.label}</p>
                <p className="mt-1 font-mono-tabular text-2xl font-bold">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
              <h3 className="font-display text-base font-bold mb-3">Service Division Breakdown</h3>
              <HorizontalBarChart
                items={data.serviceReport.map((s) => ({
                  label: s.category,
                  value: s.count,
                  sublabel: `$${s.totalBudget.toLocaleString()}`
                }))}
              />
            </div>

            <div className="rounded-xl border border-emerald-950/12 bg-white p-5 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
              <h3 className="font-display text-base font-bold mb-3">Client Portfolio Value</h3>
              <HorizontalBarChart
                items={data.clientReport.map((c) => ({
                  label: c.name,
                  value: c.workOrdersCount,
                  sublabel: `$${c.totalBudget.toLocaleString()}`
                }))}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-emerald-950/12 bg-white shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
            <div className="border-b border-emerald-950/10 px-5 py-3 dark:border-lime-300/15">
              <h3 className="font-display text-base font-bold">Vendor Performance Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F6FAF1] text-[11px] font-bold uppercase dark:bg-[#052312]">
                  <tr>
                    <th className="px-4 py-2.5">Code</th>
                    <th className="px-4 py-2.5">Vendor Company</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Active Assigned</th>
                    <th className="px-4 py-2.5">Completed</th>
                    <th className="px-4 py-2.5">Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                  {data.vendorReport.map((v) => (
                    <tr key={v.id}>
                      <td className="px-4 py-2.5 font-mono-tabular font-bold">{v.vendorCode}</td>
                      <td className="px-4 py-2.5 font-semibold">{v.companyName}</td>
                      <td className="px-4 py-2.5">{v.applicationStatus}</td>
                      <td className="px-4 py-2.5 font-mono-tabular">{v.assignedActive}</td>
                      <td className="px-4 py-2.5 font-mono-tabular">{v.completedWorkOrders}</td>
                      <td className="px-4 py-2.5 font-mono-tabular">{v.rating ?? 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
