import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { categoriesApi, reportsApi } from '../api';
import api from '../lib/axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { format, subDays } from 'date-fns';
import { useCurrencyStore } from '../stores/currencyStore';
import { Download, FileSpreadsheet } from 'lucide-react';
import { exportToExcel } from '../utils/excel';

const tabs = ['Sales', 'Profit & Loss', 'Inventory', 'Cashier Performance', 'Daily Summary', 'Monthly Report', 'Stock Variances', 'Branch Consolidation'];

export default function ReportsPage() {
  const [tab, setTab] = useState('Sales');
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dailyDate, setDailyDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [monthlyMonth, setMonthlyMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [categoryId, setCategoryId] = useState('');
  const { format: fmt } = useCurrencyStore();

  const { data: categories = [] } = useQuery({
    queryKey: ['report-categories'],
    queryFn: () => categoriesApi.list().then(r => r.data?.data || []),
    staleTime: 60000,
  });

  const rangeParams = { date_from: from, date_to: to };
  const categoryParams = categoryId ? { category_id: Number(categoryId) } : {};

  const { data: salesData } = useQuery({ queryKey: ['report-sales', from, to], queryFn: () => reportsApi.sales(rangeParams).then(r => r.data?.data), enabled: tab === 'Sales' });
  const { data: plData }    = useQuery({ queryKey: ['report-pl', from, to], queryFn: () => reportsApi.profitLoss(rangeParams).then(r => r.data?.data), enabled: tab === 'Profit & Loss' });
  const { data: invData }   = useQuery({ queryKey: ['report-inventory', categoryId], queryFn: () => reportsApi.inventory(categoryParams).then(r => r.data?.data), enabled: tab === 'Inventory' });
  const { data: cpData }    = useQuery({ queryKey: ['report-cp', from, to], queryFn: () => reportsApi.cashierPerformance(rangeParams).then(r => r.data?.data), enabled: tab === 'Cashier Performance' });
  const { data: dailyData, isLoading: loadingDaily }   = useQuery({ queryKey: ['report-daily', dailyDate], queryFn: () => api.get('/reports/daily', { params: { date: dailyDate } }).then(r => r.data?.data), enabled: tab === 'Daily Summary' });
  const { data: monthlyData, isLoading: loadingMonthly } = useQuery({ queryKey: ['report-monthly', monthlyMonth], queryFn: () => api.get('/reports/monthly', { params: { month: monthlyMonth } }).then(r => r.data?.data), enabled: tab === 'Monthly Report' });
  const { data: stockData, isLoading: loadingStock }   = useQuery({ queryKey: ['report-stock-variances', from, to, categoryId], queryFn: () => api.get('/reports/stock-variances', { params: { ...rangeParams, ...categoryParams } }).then(r => r.data?.data), enabled: tab === 'Stock Variances' });
  const { data: consolidationData, isLoading: loadingConsolidation } = useQuery({ queryKey: ['report-consolidation', from, to], queryFn: () => api.get('/reports/branch-consolidation', { params: { date_from: from, date_to: to } }).then(r => r.data?.data), enabled: tab === 'Branch Consolidation' });

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

  const handleExportExcel = () => {
    if (tab === 'Sales' && salesData?.daily_breakdown) {
      exportToExcel(
        [['Date', 'Revenue', 'Transactions'],
         ...salesData.daily_breakdown.map((d: any) => [d.date, d.revenue, d.transactions])],
        `sales-report-${from}-${to}`
      );
    } else if (tab === 'Profit & Loss' && plData) {
      exportToExcel(
        [['Item', 'Amount'],
         ['Revenue', plData.revenue], ['Cost of Sales (COGS)', plData.cogs],
         ['Gross Profit', plData.gross_profit], ['Gross Margin %', plData.gross_margin + '%'],
         ['Expenses', plData.expenses], ['Net Profit', plData.net_profit],
         ['Net Margin %', plData.net_margin + '%']],
        `profit-loss-${from}-${to}`
      );
    } else if (tab === 'Inventory' && invData?.products) {
      exportToExcel(
        [['Product', 'SKU', 'Category', 'Cost Price', 'Selling Price', 'Stock Qty', 'Stock Value', 'Reorder Level', 'Status'],
         ...invData.products.map((p: any) => [p.name, p.sku, p.category, p.cost_price, p.selling_price, p.stock_qty, p.stock_value, p.reorder_level, p.is_out ? 'OUT' : p.is_low_stock ? 'LOW' : 'OK'])],
        `inventory-report`
      );
    } else if (tab === 'Cashier Performance' && Array.isArray(cpData)) {
      exportToExcel(
        [['Cashier', 'Transactions', 'Total Revenue', 'Avg Sale'],
         ...cpData.map((c: any) => [c.name, c.transactions, c.revenue, c.avg_sale])],
        `cashier-performance-${from}-${to}`
      );
    } else if (tab === 'Daily Summary' && dailyData) {
      exportToExcel(
        [['Daily Sales Report', dailyDate],
         [],
         ['Metric', 'Value'],
         ['Total Revenue', dailyData.total_revenue], ['Transactions', dailyData.total_transactions],
         ['Gross Profit', dailyData.gross_profit], ['Net Profit', dailyData.net_profit],
         ['Cash Sales', dailyData.cash_sales], ['Card Sales', dailyData.card_sales],
         ['Mobile Money', dailyData.mobile_money_sales], ['Expenses', dailyData.total_expenses],
         [], ['Cashier Breakdown'],
         ['Cashier', 'Transactions', 'Revenue'],
         ...(dailyData.cashier_breakdown || []).map((c: any) => [c.cashier, c.transactions, c.revenue])],
        `daily-report-${dailyDate}`
      );
    } else if (tab === 'Monthly Report' && monthlyData) {
      exportToExcel(
        [['Monthly Sales Report', monthlyMonth],
         [],
         ['Metric', 'Value'],
         ['Revenue', monthlyData.total_revenue], ['Transactions', monthlyData.total_transactions],
         ['COGS', monthlyData.cogs], ['Gross Profit', monthlyData.gross_profit],
         ['Gross Margin %', monthlyData.gross_margin + '%'], ['Expenses', monthlyData.total_expenses],
         ['Net Profit', monthlyData.net_profit],
         [], ['Daily Breakdown'], ['Date', 'Transactions', 'Revenue'],
         ...(monthlyData.daily_breakdown || []).map((d: any) => [d.date, d.transactions, d.revenue])],
        `monthly-report-${monthlyMonth}`
      );
    } else if (tab === 'Stock Variances' && stockData?.products) {
      exportToExcel(
        [['Product', 'SKU', 'Category', 'Stock', 'Reorder Level', 'Units Sold', 'Stock Value', 'Status'],
         ...stockData.products.map((p: any) => [p.name, p.sku, p.category, p.current_stock, p.reorder_level, p.units_sold, p.stock_value, p.is_out ? 'OUT' : p.is_low_stock ? 'LOW' : 'OK'])],
        `stock-variances-${from}-${to}`
      );
    } else if (tab === 'Branch Consolidation' && consolidationData) {
      const branches = consolidationData.branches || [];
      const totals   = consolidationData.totals || {};
      exportToExcel(
        [['Branch Consolidation Report', `${from} to ${to}`],
         [],
         ['Branch', 'Sales', 'COGS', 'Gross Profit', 'GP %', 'Expenses', 'Net Profit', 'Transactions'],
         ...branches.map((b: any) => [b.branch_name, b.sales, b.cogs, b.gross_profit, b.gp_percent + '%', b.expenses, b.net_profit, b.transactions]),
         [],
         ['TOTAL', totals.sales, totals.cogs, totals.gross_profit, '', totals.expenses, totals.net_profit, totals.transactions]],
        `branch-consolidation-${from}-${to}`
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm">Business analytics and insights</p>
        </div>
        <button type="button" onClick={handleExportExcel}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm">
          <FileSpreadsheet size={16} /> Export Excel
        </button>
      </div>

      {/* Date filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-wrap gap-3 items-center">
        {['Sales', 'Profit & Loss', 'Cashier Performance', 'Stock Variances', 'Branch Consolidation'].includes(tab) && (
          <>
            <label className="text-sm text-gray-600">From:</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <label className="text-sm text-gray-600">To:</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </>
        )}
        {['Inventory', 'Stock Variances'].includes(tab) && (
          <>
            <label className="text-sm text-gray-600">Category:</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">All Categories</option>
              {(categories as any[]).map((category: any) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </>
        )}
        {tab === 'Daily Summary' && (
          <>
            <label className="text-sm text-gray-600">Date:</label>
            <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={() => downloadPdf('/reports/daily/pdf', { date: dailyDate })} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
              <Download size={13} /> PDF
            </button>
          </>
        )}
        {tab === 'Monthly Report' && (
          <>
            <label className="text-sm text-gray-600">Month:</label>
            <input type="month" value={monthlyMonth} onChange={(e) => setMonthlyMonth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            <button onClick={() => downloadPdf('/reports/monthly/pdf', { month: monthlyMonth })} className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
              <Download size={13} /> PDF
            </button>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-gray-200">
        {tabs.map((t) => (
          <button type="button" key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Sales */}
      {tab === 'Sales' && salesData && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[['Total Revenue', `${fmt(salesData.total_revenue || 0)}`], ['Total Sales', salesData.total_sales], ['Avg Order Value', `${fmt(salesData.avg_order_value || 0)}`]].map(([label, val]) => (
              <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100"><p className="text-sm text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-900 mt-1">{val}</p></div>
            ))}
          </div>
          {salesData.daily_breakdown && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-800 mb-4">Daily Sales</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={salesData.daily_breakdown}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => [`${fmt(v as number)}`]} /><Bar dataKey="revenue" fill="#f59e0b" name="Revenue" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* P&L */}
      {tab === 'Profit & Loss' && plData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[['Revenue', plData.revenue, 'text-blue-600'], ['COGS', plData.cogs, 'text-red-600'], ['Gross Profit', plData.gross_profit, 'text-green-600'], ['Net Profit', plData.net_profit, plData.net_profit >= 0 ? 'text-green-600' : 'text-red-600']].map(([label, val, color]) => (
            <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100"><p className="text-sm text-gray-500">{label}</p><p className={`text-2xl font-bold mt-1 ${color}`}>{fmt(Number(val) || 0)}</p></div>
          ))}
        </div>
      )}

      {/* Inventory */}
      {tab === 'Inventory' && invData && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[['Total Products', invData.summary?.total_products], ['Stock Value', fmt(invData.summary?.total_stock_value || 0)], ['Low Stock', invData.summary?.low_stock_count]].map(([label, val]) => (
              <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100"><p className="text-sm text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-900 mt-1">{val}</p></div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>{['Product','SKU','Category','Cost','Sell Price','Stock','Value','Status'].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {invData.products?.map((p: any) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{p.name}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono text-xs">{p.sku}</td>
                      <td className="px-4 py-2 text-gray-500">{p.category}</td>
                      <td className="px-4 py-2">{fmt(p.cost_price)}</td>
                      <td className="px-4 py-2">{fmt(p.selling_price)}</td>
                      <td className="px-4 py-2 font-semibold">{p.stock_qty}</td>
                      <td className="px-4 py-2">{fmt(p.stock_value)}</td>
                      <td className="px-4 py-2">{p.is_out ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Out</span> : p.is_low_stock ? <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Low</span> : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                <thead className="bg-gray-50"><tr>{['Cashier','Sales Count','Total Revenue','Avg Sale'].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {cpData.map((c: any) => (
                    <tr key={c.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3">{c.transactions}</td>
                      <td className="px-4 py-3 font-semibold text-amber-600">{fmt(c.revenue)}</td>
                      <td className="px-4 py-3">{fmt(c.avg_sale)}</td>
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
        loadingDaily ? <div className="grid grid-cols-4 gap-4">{Array.from({length:8}).map((_,i)=><div key={i} className="bg-gray-100 rounded-xl h-20 animate-pulse"/>)}</div>
        : dailyData ? (
          <div className="space-y-4">
            {/* P&L Summary strip */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">P&L — {dailyDate}</div>
              <div className="divide-y divide-gray-50">
                {[['Sales', dailyData.total_revenue, false], ['Less Cost of Sales', dailyData.cogs, true], ['Gross Profit', dailyData.gross_profit, false], ['Less Deductions / Expenses', dailyData.total_expenses, true], ['Profit B/d (Net Profit)', dailyData.net_profit, false]].map(([label, val, neg]) => (
                  <div key={label as string} className="flex justify-between px-5 py-2.5 text-sm">
                    <span className="text-gray-600">{label as string}</span>
                    <span className={`font-semibold ${neg ? 'text-red-600' : Number(val) >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(Number(val) || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[['Cash', dailyData.cash_sales], ['Card', dailyData.card_sales], ['Mobile Money', dailyData.mobile_money_sales], ['Transactions', dailyData.total_transactions]].map(([label, val]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-xl p-4"><p className="text-xs text-gray-500">{label}</p><p className="text-lg font-bold text-gray-900 mt-1">{typeof val === 'number' && label !== 'Transactions' ? fmt(val) : val}</p></div>
              ))}
            </div>
            {dailyData.cashier_breakdown?.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b font-medium text-sm text-gray-700">Cashier Breakdown</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="px-4 py-2 text-left">Cashier</th><th className="px-4 py-2 text-right">Transactions</th><th className="px-4 py-2 text-right">Revenue</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">{dailyData.cashier_breakdown.map((c: any) => <tr key={c.username}><td className="px-4 py-2">{c.cashier} <span className="text-gray-400">@{c.username}</span></td><td className="px-4 py-2 text-right">{c.transactions}</td><td className="px-4 py-2 text-right font-medium">{fmt(c.revenue)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        ) : <p className="text-gray-400">No data for this date.</p>
      )}

      {/* Monthly Report */}
      {tab === 'Monthly Report' && (
        loadingMonthly ? <div className="grid grid-cols-4 gap-4">{Array.from({length:8}).map((_,i)=><div key={i} className="bg-gray-100 rounded-xl h-20 animate-pulse"/>)}</div>
        : monthlyData ? (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">P&L — {monthlyMonth}</div>
              <div className="divide-y divide-gray-50">
                {[['Sales', monthlyData.total_revenue, false], ['Less Cost of Sales', monthlyData.cogs, true], ['Gross Profit', monthlyData.gross_profit, false], ['GP %', monthlyData.gross_margin + '%', false], ['Less Deductions', monthlyData.total_expenses, true], ['Profit B/d', monthlyData.net_profit, false]].map(([label, val, neg]) => (
                  <div key={label as string} className="flex justify-between px-5 py-2.5 text-sm">
                    <span className="text-gray-600">{label as string}</span>
                    <span className={`font-semibold ${neg ? 'text-red-600' : 'text-gray-900'}`}>{typeof val === 'number' ? fmt(val) : val}</span>
                  </div>
                ))}
              </div>
            </div>
            {monthlyData.daily_breakdown?.length > 0 && (
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <ResponsiveContainer width="100%" height={240}><BarChart data={monthlyData.daily_breakdown}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" /><XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(8)} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="revenue" fill="#7c3aed" name="Revenue" radius={[3,3,0,0]} /></BarChart></ResponsiveContainer>
              </div>
            )}
          </div>
        ) : <p className="text-gray-400">No data for this month.</p>
      )}

      {/* Stock Variances */}
      {tab === 'Stock Variances' && (
        loadingStock ? <div className="bg-gray-100 rounded-xl h-32 animate-pulse"/> :
        stockData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[['Total Stock Value', fmt(stockData.total_stock_value)], ['Low Stock Items', stockData.low_stock_count], ['Out of Stock', stockData.out_of_stock]].map(([label, value]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-xl p-4"><p className="text-xs text-gray-500">{label}</p><p className="text-lg font-bold text-gray-900 mt-1">{value}</p></div>
              ))}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="px-4 py-2 text-left">Product</th><th className="px-4 py-2 text-left">SKU</th><th className="px-4 py-2 text-left">Category</th><th className="px-4 py-2 text-right">Stock</th><th className="px-4 py-2 text-right">Reorder</th><th className="px-4 py-2 text-right">Sold</th><th className="px-4 py-2 text-right">Revenue</th><th className="px-4 py-2 text-right">Value</th><th className="px-4 py-2 text-center">Status</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {stockData.products?.map((p: any) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2 text-gray-500">{p.sku}</td><td className="px-4 py-2 text-gray-500">{p.category || '—'}</td><td className="px-4 py-2 text-right">{p.current_stock}</td><td className="px-4 py-2 text-right">{p.reorder_level}</td><td className="px-4 py-2 text-right">{p.units_sold}</td><td className="px-4 py-2 text-right">{fmt(p.revenue || 0)}</td><td className="px-4 py-2 text-right">{fmt(p.stock_value)}</td>
                        <td className="px-4 py-2 text-center">{p.is_out ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Out</span> : p.is_low_stock ? <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Low</span> : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : <p className="text-gray-400">No stock data.</p>
      )}

      {/* Branch Consolidation */}
      {tab === 'Branch Consolidation' && (
        loadingConsolidation ? <div className="bg-gray-100 rounded-xl h-32 animate-pulse"/> :
        consolidationData ? (
          <div className="space-y-4">
            {/* Totals */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[['Total Sales', consolidationData.totals?.sales, 'text-blue-600'], ['Total Gross Profit', consolidationData.totals?.gross_profit, 'text-green-600'], ['Total Expenses', consolidationData.totals?.expenses, 'text-red-600'], ['Total Net Profit', consolidationData.totals?.net_profit, consolidationData.totals?.net_profit >= 0 ? 'text-green-600' : 'text-red-600']].map(([label, val, color]) => (
                <div key={label as string} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                  <p className="text-xs text-gray-500">{label as string}</p>
                  <p className={`text-xl font-bold mt-1 ${color}`}>{fmt(Number(val) || 0)}</p>
                </div>
              ))}
            </div>

            {/* Branch comparison table */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-800">
                Branch Performance — {from} to {to}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>{['Branch','Sales','Cost of Sales','Gross Profit','GP %','Expenses','Net Profit','Transactions'].map(h=><th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(consolidationData.branches || []).map((b: any) => (
                      <tr key={b.branch_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold text-gray-900">{b.branch_name}</td>
                        <td className="px-4 py-3 text-blue-700 font-medium">{fmt(b.sales)}</td>
                        <td className="px-4 py-3 text-red-600">{fmt(b.cogs)}</td>
                        <td className="px-4 py-3 text-green-700 font-medium">{fmt(b.gross_profit)}</td>
                        <td className="px-4 py-3 text-gray-600">{b.gp_percent}%</td>
                        <td className="px-4 py-3 text-red-600">{fmt(b.expenses)}</td>
                        <td className={`px-4 py-3 font-bold ${b.net_profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(b.net_profit)}</td>
                        <td className="px-4 py-3 text-gray-600">{b.transactions}</td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    {consolidationData.totals && (
                      <tr className="bg-gray-100 font-bold">
                        <td className="px-4 py-3 text-gray-900">TOTAL</td>
                        <td className="px-4 py-3 text-blue-700">{fmt(consolidationData.totals.sales)}</td>
                        <td className="px-4 py-3 text-red-600">{fmt(consolidationData.totals.cogs)}</td>
                        <td className="px-4 py-3 text-green-700">{fmt(consolidationData.totals.gross_profit)}</td>
                        <td className="px-4 py-3">—</td>
                        <td className="px-4 py-3 text-red-600">{fmt(consolidationData.totals.expenses)}</td>
                        <td className={`px-4 py-3 ${consolidationData.totals.net_profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(consolidationData.totals.net_profit)}</td>
                        <td className="px-4 py-3 text-gray-700">{consolidationData.totals.transactions}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : <p className="text-gray-400 text-center py-12">Select a date range and the report will load automatically.</p>
      )}
    </div>
  );
}
