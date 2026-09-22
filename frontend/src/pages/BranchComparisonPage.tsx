import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Building2, TrendingUp } from 'lucide-react';
import { reportsApi } from '../api';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';

export default function BranchComparisonPage() {
  const isAdmin = useAuthStore((s) => s.hasRole('admin'));
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [dateTo, setDateTo]     = useState(today);
  const { format: formatAmount } = useCurrencyStore();

  const { data, isLoading } = useQuery({
    queryKey: ['branch-comparison', dateFrom, dateTo],
    queryFn: () => reportsApi.branchComparison({ date_from: dateFrom, date_to: dateTo }).then(r => r.data?.data),
    enabled: isAdmin,
  });

  // Only admin may view/compare across branches — every other role is
  // already locked to their own branch by the backend.
  if (!isAdmin) return <Navigate to="/" replace />;

  const rows = data?.rows || [];
  const totals = data?.totals;
  const chartData = rows.map((r: any) => ({ name: r.branch_name, Revenue: r.revenue }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Building2 size={22} /> Compare Branches</h1>
        <p className="text-gray-500 text-sm">See which branch is performing best over a given period</p>
      </div>

      <div className="bg-white rounded-md border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No branches with data for this period</div>
      ) : (
        <>
          <div className="bg-white rounded-md border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><TrendingUp size={15} /> Revenue by Branch</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatAmount(v)} width={80} />
                <Tooltip formatter={(v) => formatAmount(Number(v))} />
                <Bar dataKey="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-md border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-gray-50">
                  <tr>
                    {['Branch', 'Revenue', 'Gross Profit', 'GP %', 'Expenses', 'Net Profit', 'Transactions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r: any, i: number) => (
                    <tr key={r.branch_id} className={i === 0 ? 'bg-blue-50/50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {r.branch_name} {i === 0 && <span className="ml-1.5 text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full align-middle">TOP</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">{formatAmount(r.revenue)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">{formatAmount(r.gross_profit)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">{r.gp_percent}%</td>
                      <td className="px-4 py-3 text-sm text-red-600 tabular-nums">{formatAmount(r.expenses)}</td>
                      <td className={`px-4 py-3 text-sm font-semibold tabular-nums ${r.net_profit < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatAmount(r.net_profit)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">{r.transaction_count}</td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900">Total</td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">{formatAmount(totals.revenue)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">{formatAmount(totals.gross_profit)}</td>
                      <td className="px-4 py-3 text-sm"></td>
                      <td className="px-4 py-3 text-sm font-bold text-red-600 tabular-nums">{formatAmount(totals.expenses)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">{formatAmount(totals.net_profit)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">{totals.transaction_count}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
