import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { format, subDays } from 'date-fns';

const tabs = ['Sales', 'Profit & Loss', 'Inventory', 'Cashier Performance'];

export default function ReportsPage() {
  const [tab, setTab] = useState('Sales');
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: salesData } = useQuery({
    queryKey: ['report-sales', from, to],
    queryFn: () => reportsApi.sales({ from, to }).then(r => r.data?.data),
    enabled: tab === 'Sales',
  });

  const { data: plData } = useQuery({
    queryKey: ['report-pl', from, to],
    queryFn: () => reportsApi.profitLoss({ from, to }).then(r => r.data?.data),
    enabled: tab === 'Profit & Loss',
  });

  const { data: invData } = useQuery({
    queryKey: ['report-inventory'],
    queryFn: () => reportsApi.inventory().then(r => r.data?.data),
    enabled: tab === 'Inventory',
  });

  const { data: cpData } = useQuery({
    queryKey: ['report-cp', from, to],
    queryFn: () => reportsApi.cashierPerformance({ from, to }).then(r => r.data?.data),
    enabled: tab === 'Cashier Performance',
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 text-sm">Business analytics and insights</p>
      </div>

      {/* Date filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">From:</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">To:</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Sales Report */}
      {tab === 'Sales' && salesData && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[['Total Revenue', `R ${parseFloat(salesData.total_revenue || 0).toFixed(2)}`], ['Total Sales', salesData.total_sales], ['Avg Order Value', `R ${parseFloat(salesData.avg_order_value || 0).toFixed(2)}`]].map(([label, val]) => (
              <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{val}</p>
              </div>
            ))}
          </div>
          {salesData.daily_breakdown && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-800 mb-4">Daily Sales</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={salesData.daily_breakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R${v}`} />
                  <Tooltip formatter={(v) => [`R ${(v as number)?.toFixed(2)}`]} />
                  <Bar dataKey="revenue" fill="#f59e0b" name="Revenue" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Profit & Loss */}
      {tab === 'Profit & Loss' && plData && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[['Revenue', plData.revenue, 'text-blue-600'], ['COGS', plData.cogs, 'text-red-600'], ['Gross Profit', plData.gross_profit, 'text-green-600'], ['Net Profit', plData.net_profit, plData.net_profit >= 0 ? 'text-green-600' : 'text-red-600']].map(([label, val, color]) => (
              <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <p className="text-sm text-gray-500">{label}</p>
                <p className={`text-2xl font-bold mt-1 ${color}`}>R {parseFloat(String(val) || '0').toFixed(2)}</p>
              </div>
            ))}
          </div>
          {plData.expenses_total !== undefined && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Total Expenses</span>
                <span className="font-semibold text-red-600">R {parseFloat(plData.expenses_total || 0).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inventory */}
      {tab === 'Inventory' && invData && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[['Total Products', invData.total_products], ['Total Stock Value', `R ${parseFloat(invData.total_stock_value || 0).toFixed(2)}`], ['Low Stock Items', invData.low_stock_items]].map(([label, val]) => (
              <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{val}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cashier Performance */}
      {tab === 'Cashier Performance' && cpData && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">Cashier Performance</h3>
          {cpData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>{['Cashier', 'Sales Count', 'Total Revenue', 'Avg Sale'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {cpData.map((c: any) => (
                    <tr key={c.cashier_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 text-gray-600">{c.sales_count}</td>
                      <td className="px-4 py-3 text-amber-600 font-semibold">R {parseFloat(c.total_revenue || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-600">R {parseFloat(c.avg_sale || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-gray-400 text-center py-8">No data for selected period</p>}
        </div>
      )}
    </div>
  );
}
