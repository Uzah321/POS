import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api';
import api from '../lib/axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { format, subDays } from 'date-fns';
import { useCurrencyStore } from '../stores/currencyStore';

const tabs = ['Sales', 'Profit & Loss', 'Inventory', 'Cashier Performance', 'Daily Summary', 'Monthly Report', 'Stock Variances'];

export default function ReportsPage() {
  const [tab, setTab] = useState('Sales');
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dailyDate, setDailyDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [monthlyMonth, setMonthlyMonth] = useState(format(new Date(), 'yyyy-MM'));
  const { format: fmt } = useCurrencyStore();

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

  const { data: dailyData, isLoading: loadingDaily } = useQuery({
    queryKey: ['report-daily', dailyDate],
    queryFn: () => api.get('/reports/daily', { params: { date: dailyDate } }).then(r => r.data?.data),
    enabled: tab === 'Daily Summary',
  });

  const { data: monthlyData, isLoading: loadingMonthly } = useQuery({
    queryKey: ['report-monthly', monthlyMonth],
    queryFn: () => api.get('/reports/monthly', { params: { month: monthlyMonth } }).then(r => r.data?.data),
    enabled: tab === 'Monthly Report',
  });

  const { data: stockData, isLoading: loadingStock } = useQuery({
    queryKey: ['report-stock-variances', from, to],
    queryFn: () => api.get('/reports/stock-variances', { params: { from, to } }).then(r => r.data?.data),
    enabled: tab === 'Stock Variances',
  });

  const downloadPdf = (url: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    const token = localStorage.getItem('token');
    fetch(`/api${url}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = url.replace('/reports/', '').replace('/', '-') + `-${Object.values(params)[0]}.pdf`;
        a.click();
      });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 text-sm">Business analytics and insights</p>
      </div>

      {/* Date filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-wrap gap-3 items-center">
        {['Sales', 'Profit & Loss', 'Cashier Performance', 'Stock Variances'].includes(tab) && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">From:</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">To:</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </>
        )}
        {tab === 'Daily Summary' && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Date:</label>
            <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={() => downloadPdf('/reports/daily/pdf', { date: dailyDate })} className="ml-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">Download PDF</button>
          </div>
        )}
        {tab === 'Monthly Report' && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Month:</label>
            <input type="month" value={monthlyMonth} onChange={(e) => setMonthlyMonth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            <button onClick={() => downloadPdf('/reports/monthly/pdf', { month: monthlyMonth })} className="ml-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">Download PDF</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-gray-200">
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
                      <td className="px-4 py-3 text-gray-600">{c.sales_count ?? c.transactions}</td>
                      <td className="px-4 py-3 text-amber-600 font-semibold">R {parseFloat(c.total_revenue ?? c.revenue ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-600">R {parseFloat(c.avg_sale ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-gray-400 text-center py-8">No data for selected period</p>}
        </div>
      )}

      {/* Daily Summary */}
      {tab === 'Daily Summary' && (
        loadingDaily ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-gray-100 rounded-xl h-20 animate-pulse" />)}</div>
        ) : dailyData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[['Total Revenue', fmt(dailyData.total_revenue)], ['Transactions', String(dailyData.total_transactions)], ['Gross Profit', fmt(dailyData.gross_profit)], ['Net Profit', fmt(dailyData.net_profit)],
                ['Cash', fmt(dailyData.cash_sales)], ['Card', fmt(dailyData.card_sales)], ['Mobile Money', fmt(dailyData.mobile_money_sales)], ['Expenses', fmt(dailyData.total_expenses)]
              ].map(([label, value]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-base font-bold text-gray-900 mt-1">{value}</p>
                </div>
              ))}
            </div>
            {dailyData.cashier_breakdown?.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b font-medium text-sm text-gray-700">Cashier Breakdown</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr><th className="px-4 py-2 text-left">Cashier</th><th className="px-4 py-2 text-right">Transactions</th><th className="px-4 py-2 text-right">Revenue</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dailyData.cashier_breakdown.map((c: any) => (
                      <tr key={c.username}><td className="px-4 py-2">{c.cashier} <span className="text-gray-400">@{c.username}</span></td><td className="px-4 py-2 text-right">{c.transactions}</td><td className="px-4 py-2 text-right font-medium">{fmt(c.revenue)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : <p className="text-gray-400">No data for this date.</p>
      )}

      {/* Monthly Report */}
      {tab === 'Monthly Report' && (
        loadingMonthly ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-gray-100 rounded-xl h-20 animate-pulse" />)}</div>
        ) : monthlyData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[['Revenue', fmt(monthlyData.total_revenue)], ['Transactions', String(monthlyData.total_transactions)], ['Gross Profit', fmt(monthlyData.gross_profit) + ` (${monthlyData.gross_margin}%)`], ['Net Profit', fmt(monthlyData.net_profit) + ` (${monthlyData.net_margin}%)`],
                ['COGS', fmt(monthlyData.cogs)], ['Expenses', fmt(monthlyData.total_expenses)], ['Period', `${monthlyData.from} → ${monthlyData.to}`], ['Avg/Day', monthlyData.daily_breakdown?.length ? fmt(monthlyData.total_revenue / monthlyData.daily_breakdown.length) : '—']
              ].map(([label, value]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-sm font-bold text-gray-900 mt-1">{value}</p>
                </div>
              ))}
            </div>
            {monthlyData.daily_breakdown?.length > 0 && (
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <h3 className="font-semibold text-gray-800 mb-4">Daily Breakdown</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthlyData.daily_breakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(8)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="revenue" fill="#7c3aed" name="Revenue" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : <p className="text-gray-400">No data for this month.</p>
      )}

      {/* Stock Variances */}
      {tab === 'Stock Variances' && (
        loadingStock ? (
          <div className="bg-gray-100 rounded-xl h-32 animate-pulse" />
        ) : stockData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[['Total Stock Value', fmt(stockData.total_stock_value)], ['Low Stock Items', String(stockData.low_stock_count)], ['Out of Stock', String(stockData.out_of_stock)]].map(([label, value]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b font-medium text-sm text-gray-700">Products</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Product</th>
                      <th className="px-4 py-2 text-left">SKU</th>
                      <th className="px-4 py-2 text-right">Stock</th>
                      <th className="px-4 py-2 text-right">Reorder</th>
                      <th className="px-4 py-2 text-right">Sold</th>
                      <th className="px-4 py-2 text-right">Stock Value</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {stockData.products?.map((p: any) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{p.name}</td>
                        <td className="px-4 py-2 text-gray-500">{p.sku}</td>
                        <td className="px-4 py-2 text-right">{p.current_stock}</td>
                        <td className="px-4 py-2 text-right">{p.reorder_level}</td>
                        <td className="px-4 py-2 text-right">{p.units_sold}</td>
                        <td className="px-4 py-2 text-right">{fmt(p.stock_value)}</td>
                        <td className="px-4 py-2 text-center">
                          {p.is_out ? (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Out</span>
                          ) : p.is_low_stock ? (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Low</span>
                          ) : (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : <p className="text-gray-400">No stock data.</p>
      )}
    </div>
  );
}
