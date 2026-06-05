import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { financialReportApi, branchesApi } from '../api';
import { Download, Loader2, BarChart2, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

type Period = 'daily' | 'weekly' | 'monthly';

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

function PLRow({ label, value, isBold, isNegative, isPercent, isHighlight }: {
  label: string; value: number | string; isBold?: boolean; isNegative?: boolean; isPercent?: boolean; isHighlight?: boolean;
}) {
  const displayVal = isPercent ? `${value}%` : `$${Number(value).toFixed(2)}`;
  return (
    <div className={`flex items-center justify-between px-6 py-3 border-b border-gray-100 last:border-0 ${isHighlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
      <span className={`text-sm ${isBold ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${
        isHighlight ? 'text-blue-700 text-base' :
        isNegative ? 'text-red-600' :
        isBold ? 'text-gray-900' : 'text-gray-700'
      }`}>
        {displayVal}
      </span>
    </div>
  );
}

export default function FinancialReportPage() {
  const today = new Date().toISOString().split('T')[0];
  const [period, setPeriod]       = useState<Period>('daily');
  const [dateFrom, setDateFrom]   = useState(today);
  const [dateTo, setDateTo]       = useState(today);
  const [month, setMonth]         = useState(new Date().toISOString().slice(0, 7));
  const [branchId, setBranchId]   = useState('');

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []) });
  const branches = branchData || [];

  const queryParams = period === 'monthly'
    ? { period: 'monthly', month, branch_id: branchId || undefined }
    : { period, date_from: dateFrom, date_to: dateTo, branch_id: branchId || undefined };

  const { data: reportData, isLoading, refetch } = useQuery({
    queryKey: ['financial-report', queryParams],
    queryFn: () => financialReportApi.summary(queryParams).then(r => r.data?.data),
  });

  const handleExportCsv = async () => {
    try {
      const res = await financialReportApi.exportCsv(queryParams);
      downloadBlob(res.data, `financial-report-${period}.csv`);
    } catch { toast.error('Export failed'); }
  };

  const handleDailyCsv = async () => {
    try {
      const res = await financialReportApi.dailyCsv({ date: dateFrom, branch_id: branchId || undefined });
      downloadBlob(res.data, `daily-sales-${dateFrom}.csv`);
    } catch { toast.error('Export failed'); }
  };

  const handleMonthlyCsv = async () => {
    try {
      const res = await financialReportApi.monthlyCsv({ month, branch_id: branchId || undefined });
      downloadBlob(res.data, `monthly-report-${month}.csv`);
    } catch { toast.error('Export failed'); }
  };

  const report = reportData;

  const paymentBreakdown = report?.payment_breakdown
    ? Object.entries(report.payment_breakdown).map(([method, data]: [string, any]) => ({
        method: method.replace('_', ' ').toUpperCase(),
        amount: Number(data.total ?? data ?? 0),
      }))
    : [];

  const dailyChart = (report?.daily_breakdown || []).map((d: any) => ({
    date: d.date?.slice(5),
    Revenue: Number(d.revenue),
    Transactions: d.transactions,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financial Report</h1>
          <p className="text-gray-500 text-sm">P&amp;L — Sales, Gross Profit, Deductions, Profit B/d</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={handleExportCsv} className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-xl text-sm hover:bg-gray-50">
            <Download size={14} /> Export P&amp;L CSV
          </button>
          {period === 'daily' && (
            <button type="button" onClick={handleDailyCsv} className="flex items-center gap-2 border border-blue-300 text-blue-700 px-3 py-2 rounded-xl text-sm hover:bg-blue-50">
              <Download size={14} /> Daily Detail CSV
            </button>
          )}
          {period === 'monthly' && (
            <button type="button" onClick={handleMonthlyCsv} className="flex items-center gap-2 border border-blue-300 text-blue-700 px-3 py-2 rounded-xl text-sm hover:bg-blue-50">
              <Download size={14} /> Monthly Detail CSV
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Period toggle */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Period</label>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
                <button key={p} type="button" onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-md text-sm font-medium capitalize transition-all ${period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {period === 'monthly' ? (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Month</label>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Branch</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All branches</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <button type="button" onClick={() => refetch()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Generate
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-blue-500" /></div>
      ) : report ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* P&L Statement */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <BarChart2 size={18} className="text-blue-500" />
              <h2 className="font-bold text-gray-900">Profit &amp; Loss Statement</h2>
              <span className="ml-auto text-xs text-gray-400 font-mono">{report.from} → {report.to}</span>
            </div>

            <div className="divide-y divide-gray-50">
              <PLRow label="Sales" value={report.sales} isBold />
              <PLRow label="Less: Cost of Sales" value={report.less_cost_of_sales} isNegative />
              <PLRow label="Gross Profit" value={report.gross_profit} isBold />
              <PLRow label="% GP (Gross Profit Margin)" value={report.gp_percent} isPercent />
              <PLRow label="Less: Deductions / Expenses" value={report.less_deductions} isNegative />
              <PLRow label="Profit B/d (Net Profit)" value={report.profit_bd} isBold isHighlight />
            </div>

            <div className="px-6 py-3 border-t border-gray-100 grid grid-cols-2 gap-3 bg-gray-50">
              <div className="text-center">
                <p className="text-xs text-gray-500">Transactions</p>
                <p className="text-lg font-bold text-gray-900">{report.total_transactions}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Avg. Sale Value</p>
                <p className="text-lg font-bold text-gray-900">
                  ${report.total_transactions > 0 ? (Number(report.sales) / report.total_transactions).toFixed(2) : '0.00'}
                </p>
              </div>
            </div>
          </div>

          {/* Payment Breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <TrendingUp size={18} className="text-purple-500" />
              <h2 className="font-bold text-gray-900">Payment Breakdown</h2>
            </div>
            <div className="p-4 space-y-3">
              {paymentBreakdown.length > 0 ? paymentBreakdown.map(pm => {
                const pct = report.sales > 0 ? ((pm.amount / Number(report.sales)) * 100).toFixed(1) : '0';
                return (
                  <div key={pm.method}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700 capitalize">{pm.method}</span>
                      <span className="text-gray-900 font-semibold">${pm.amount.toFixed(2)} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              }) : <p className="text-gray-400 text-sm text-center py-6">No payment data for this period</p>}
            </div>
          </div>

          {/* Daily Revenue Chart */}
          {dailyChart.length > 1 && (
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="font-bold text-gray-900">Revenue Trend</h2>
              </div>
              <div className="p-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Revenue']} />
                    <Legend />
                    <Bar dataKey="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 text-gray-400">
          <BarChart2 size={40} className="mb-3" />
          <p className="text-sm">Select a period and click Generate to view the report</p>
        </div>
      )}
    </div>
  );
}
