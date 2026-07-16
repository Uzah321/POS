import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { categoriesApi, reportsApi, branchesApi } from '../api';
import api from '../lib/axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { format, subDays } from 'date-fns';
import { useCurrencyStore } from '../stores/currencyStore';
import { useAuthStore } from '../stores/authStore';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { exportToExcel } from '../utils/excel';

const tabs = ['Sales', 'Profit & Loss', 'Inventory', 'Cashier Performance', 'Daily Summary', 'Monthly Report', 'Stock Variances', 'Branch Consolidation', 'Cashup History'];

function printCashupReport(records: any[], from: string, to: string, fmt: (n: number) => string) {
  const statusColor = (s: string) => ({ pending: '#b45309', approved: '#16a34a', rejected: '#dc2626' }[s] ?? '#6b7280');
  const rows = records.map(r => `
    <tr>
      <td>${r.user?.name ?? '-'}<br><small style="color:#888">@${r.user?.username ?? ''}</small></td>
      <td>${r.branch?.name ?? '-'}</td>
      <td>${new Date(r.shift_start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td>${new Date(r.shift_end).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td style="text-align:right">${r.total_transactions}</td>
      <td style="text-align:right">${fmt(r.total_sales)}</td>
      <td style="text-align:right">${fmt(r.cash_sales ?? 0)}</td>
      <td style="text-align:right">${fmt(r.expected_cash)}</td>
      <td style="text-align:right">${fmt(r.declared_cash)}</td>
      <td style="text-align:right; color:${r.variance >= 0 ? '#16a34a' : '#dc2626'}; font-weight:bold">
        ${r.variance >= 0 ? '+' : ''}${fmt(r.variance)}
      </td>
      <td style="text-align:center"><span style="color:${statusColor(r.status)};font-weight:600;text-transform:capitalize">${r.status}</span></td>
      <td>${r.notes ?? ''}</td>
    </tr>`).join('');

  const totalSales = records.reduce((s, r) => s + (r.total_sales || 0), 0);
  const totalExpected = records.reduce((s, r) => s + (r.expected_cash || 0), 0);
  const totalDeclared = records.reduce((s, r) => s + (r.declared_cash || 0), 0);
  const totalVariance = totalDeclared - totalExpected;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Cashup History Report</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; font-size:10px; color:#000; padding:8mm; }
  h1 { font-size:16px; text-align:center; margin-bottom:2px; }
  .sub { text-align:center; color:#555; margin-bottom:8px; font-size:11px; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th { background:#f3f4f6; border:1px solid #d1d5db; padding:4px 6px; text-align:left; font-size:9px; text-transform:uppercase; }
  td { border:1px solid #e5e7eb; padding:4px 6px; vertical-align:top; }
  tfoot td { background:#f9fafb; font-weight:bold; }
  .header-row { text-align:center; margin-bottom:4px; }
  @media print { @page { margin:8mm; size:A4 landscape; } }
</style>
</head><body>
<div class="header-row"><h1>***CASHUP HISTORY REPORT***</h1></div>
<div class="sub">${from} to ${to} &mdash; ${records.length} record${records.length !== 1 ? 's' : ''}</div>
<div class="sub">Printed: ${new Date().toLocaleString()}</div>
<table>
  <thead><tr>
    <th>Cashier</th><th>Branch</th><th>Shift Start</th><th>Shift End</th>
    <th style="text-align:right">Txns</th><th style="text-align:right">Total Sales</th>
    <th style="text-align:right">Cash Sales</th><th style="text-align:right">Expected Cash</th>
    <th style="text-align:right">Declared Cash</th><th style="text-align:right">Variance</th>
    <th style="text-align:center">Status</th><th>Notes</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="5" style="text-align:right">TOTALS</td>
    <td style="text-align:right">${fmt(totalSales)}</td>
    <td></td>
    <td style="text-align:right">${fmt(totalExpected)}</td>
    <td style="text-align:right">${fmt(totalDeclared)}</td>
    <td style="text-align:right;color:${totalVariance >= 0 ? '#16a34a' : '#dc2626'}">${totalVariance >= 0 ? '+' : ''}${fmt(totalVariance)}</td>
    <td colspan="2"></td>
  </tr></tfoot>
</table>
</body></html>`;

  const w = window.open('', '_blank', 'width=1024,height=700,toolbar=0,scrollbars=1');
  if (!w) { alert('Allow popups to print reports'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

export default function ReportsPage() {
  const [tab, setTab] = useState('Sales');
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dailyDate, setDailyDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [monthlyMonth, setMonthlyMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [categoryId, setCategoryId] = useState('');
  const [branchId, setBranchId] = useState('');
  const { format: fmt } = useCurrencyStore();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('admin');

  const { data: categories = [] } = useQuery({
    queryKey: ['report-categories'],
    queryFn: () => categoriesApi.list().then(r => r.data?.data || []),
    staleTime: 60000,
  });

  const { data: branchData = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list().then(r => r.data?.data || []),
    staleTime: 120000,
    enabled: !!isAdmin, // reports auto-scope to your own branch — only an admin needs to switch
  });

  const rangeParams = { date_from: from, date_to: to, ...(branchId ? { branch_id: Number(branchId) } : {}) };
  const categoryParams = categoryId ? { category_id: Number(categoryId) } : {};

  const { data: salesData } = useQuery({ queryKey: ['report-sales', from, to, branchId], queryFn: () => reportsApi.sales(rangeParams).then(r => r.data?.data), enabled: tab === 'Sales' });
  const { data: plData }    = useQuery({ queryKey: ['report-pl', from, to, branchId], queryFn: () => reportsApi.profitLoss(rangeParams).then(r => r.data?.data), enabled: tab === 'Profit & Loss' });
  const { data: invData }   = useQuery({ queryKey: ['report-inventory', categoryId], queryFn: () => reportsApi.inventory(categoryParams).then(r => r.data?.data), enabled: tab === 'Inventory' });
  const { data: cpData }    = useQuery({ queryKey: ['report-cp', from, to, branchId], queryFn: () => reportsApi.cashierPerformance(rangeParams).then(r => r.data?.data), enabled: tab === 'Cashier Performance' });
  const { data: dailyData, isLoading: loadingDaily }   = useQuery({ queryKey: ['report-daily', dailyDate, branchId], queryFn: () => api.get('/reports/daily', { params: { date: dailyDate, ...(branchId ? { branch_id: Number(branchId) } : {}) } }).then(r => r.data?.data), enabled: tab === 'Daily Summary' });
  const { data: monthlyData, isLoading: loadingMonthly } = useQuery({ queryKey: ['report-monthly', monthlyMonth, branchId], queryFn: () => api.get('/reports/monthly', { params: { month: monthlyMonth, ...(branchId ? { branch_id: Number(branchId) } : {}) } }).then(r => r.data?.data), enabled: tab === 'Monthly Report' });
  const { data: stockData, isLoading: loadingStock }   = useQuery({ queryKey: ['report-stock-variances', from, to, categoryId, branchId], queryFn: () => api.get('/reports/stock-variances', { params: { ...rangeParams, ...categoryParams } }).then(r => r.data?.data), enabled: tab === 'Stock Variances' });
  const { data: consolidationData, isLoading: loadingConsolidation } = useQuery({ queryKey: ['report-consolidation', from, to], queryFn: () => api.get('/reports/branch-consolidation', { params: { date_from: from, date_to: to } }).then(r => r.data?.data), enabled: tab === 'Branch Consolidation' });
  const { data: cashupRaw, isLoading: loadingCashup } = useQuery({
    queryKey: ['report-cashup', from, to, branchId],
    queryFn: () => api.get('/shift-end', { params: { date_from: from, date_to: to, ...(branchId ? { branch_id: Number(branchId) } : {}), per_page: 200 } }).then(r => r.data?.data),
    enabled: tab === 'Cashup History',
  });
  const cashupRecords: any[] = cashupRaw?.data ?? [];

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
        [['Cashier', 'Transactions', 'Total Revenue', 'Avg Sale', 'Voids', 'Refunds', 'Refund Amount', 'Shifts Closed', 'Shifts Pending Approval'],
         ...cpData.map((c: any) => [c.name, c.transactions, c.revenue, c.avg_sale, c.voids, c.refund_count, c.refund_amount, c.shifts_closed, c.shifts_pending_approval])],
        `cashier-activity-${from}-${to}`
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
    } else if (tab === 'Cashup History' && cashupRecords.length > 0) {
      exportToExcel(
        [['Cashier', 'Branch', 'Shift Start', 'Shift End', 'Transactions', 'Total Sales', 'Cash Sales', 'Expected Cash', 'Declared Cash', 'Variance', 'Status', 'Notes'],
         ...cashupRecords.map((r: any) => [r.user?.name, r.branch?.name, r.shift_start, r.shift_end, r.total_transactions, r.total_sales, r.cash_sales, r.expected_cash, r.declared_cash, r.variance, r.status, r.notes ?? ''])],
        `cashup-history-${from}-${to}`
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
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm">
          <FileSpreadsheet size={16} /> Export Excel
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-md p-4 shadow-sm border border-gray-100 flex flex-wrap gap-3 items-center">
        {['Sales', 'Profit & Loss', 'Cashier Performance', 'Stock Variances', 'Branch Consolidation', 'Cashup History'].includes(tab) && (
          <>
            <label className="text-sm text-gray-600">From:</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <label className="text-sm text-gray-600">To:</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </>
        )}
        {isAdmin && tab !== 'Branch Consolidation' && (branchData as any[]).length > 1 && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Branches</option>
            {(branchData as any[]).map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
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
        {tab === 'Cashup History' && cashupRecords.length > 0 && (
          <button
            onClick={() => printCashupReport(cashupRecords, from, to, fmt)}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            <Printer size={13} /> Print Report
          </button>
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
            {[['Total Revenue', `${fmt(salesData.summary?.total_revenue || 0)}`], ['Total Sales', salesData.summary?.total_transactions || 0], ['Avg Order Value', `${fmt(salesData.summary?.total_transactions ? salesData.summary.total_revenue / salesData.summary.total_transactions : 0)}`]].map(([label, val]) => (
              <div key={label} className="bg-white rounded-md p-5 shadow-sm border border-gray-100"><p className="text-sm text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-900 mt-1">{val}</p></div>
            ))}
          </div>
          {salesData.daily_breakdown && (
            <div className="bg-white rounded-md p-5 shadow-sm border border-gray-100">
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
            <div key={label} className="bg-white rounded-md p-5 shadow-sm border border-gray-100"><p className="text-sm text-gray-500">{label}</p><p className={`text-2xl font-bold mt-1 ${color}`}>{fmt(Number(val) || 0)}</p></div>
          ))}
        </div>
      )}

      {/* Inventory */}
      {tab === 'Inventory' && invData && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[['Total Products', invData.summary?.total_products], ['Stock Value', fmt(invData.summary?.total_stock_value || 0)], ['Low Stock', invData.summary?.low_stock_count]].map(([label, val]) => (
              <div key={label} className="bg-white rounded-md p-5 shadow-sm border border-gray-100"><p className="text-sm text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-900 mt-1">{val}</p></div>
            ))}
          </div>
          <div className="bg-white rounded-md border border-gray-100 overflow-hidden">
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

      {/* Cashier Performance / Activity */}
      {tab === 'Cashier Performance' && cpData && (
        <div className="bg-white rounded-md p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">Cashier Activity</h3>
          {cpData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>{['Cashier','Sales Count','Total Revenue','Avg Sale','Voids','Refunds','Refund Amount','Shifts Closed'].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {cpData.map((c: any) => (
                    <tr key={c.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3">{c.transactions}</td>
                      <td className="px-4 py-3 font-semibold text-amber-600">{fmt(c.revenue)}</td>
                      <td className="px-4 py-3">{fmt(c.avg_sale)}</td>
                      <td className="px-4 py-3">
                        {c.voids > 0 ? <span className="text-red-600 font-semibold">{c.voids}</span> : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-4 py-3">
                        {c.refund_count > 0 ? <span className="text-purple-600 font-semibold">{c.refund_count}</span> : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-4 py-3 text-purple-600">{c.refund_amount > 0 ? fmt(c.refund_amount) : '-'}</td>
                      <td className="px-4 py-3">
                        {c.shifts_closed}
                        {c.shifts_pending_approval > 0 && (
                          <span className="ml-1.5 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">{c.shifts_pending_approval} pending</span>
                        )}
                      </td>
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
        loadingDaily ? <div className="grid grid-cols-4 gap-4">{Array.from({length:8}).map((_,i)=><div key={i} className="bg-gray-100 rounded-md h-20 animate-pulse"/>)}</div>
        : dailyData ? (
          <div className="space-y-4">
            {/* P&L Summary strip */}
            <div className="bg-white rounded-md border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">P&L " {dailyDate}</div>
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
                <div key={label} className="bg-white border border-gray-200 rounded-md p-4"><p className="text-xs text-gray-500">{label}</p><p className="text-lg font-bold text-gray-900 mt-1">{typeof val === 'number' && label !== 'Transactions' ? fmt(val) : val}</p></div>
              ))}
            </div>
            {dailyData.cashier_breakdown?.length > 0 && (
              <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
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
        loadingMonthly ? <div className="grid grid-cols-4 gap-4">{Array.from({length:8}).map((_,i)=><div key={i} className="bg-gray-100 rounded-md h-20 animate-pulse"/>)}</div>
        : monthlyData ? (
          <div className="space-y-4">
            <div className="bg-white rounded-md border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">P&L " {monthlyMonth}</div>
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
              <div className="bg-white rounded-md p-5 border border-gray-200">
                <ResponsiveContainer width="100%" height={240}><BarChart data={monthlyData.daily_breakdown}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" /><XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(8)} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="revenue" fill="#7c3aed" name="Revenue" radius={[3,3,0,0]} /></BarChart></ResponsiveContainer>
              </div>
            )}
          </div>
        ) : <p className="text-gray-400">No data for this month.</p>
      )}

      {/* Stock Variances */}
      {tab === 'Stock Variances' && (
        loadingStock ? <div className="bg-gray-100 rounded-md h-32 animate-pulse"/> :
        stockData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[['Total Stock Value', fmt(stockData.total_stock_value)], ['Low Stock Items', stockData.low_stock_count], ['Out of Stock', stockData.out_of_stock]].map(([label, value]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-md p-4"><p className="text-xs text-gray-500">{label}</p><p className="text-lg font-bold text-gray-900 mt-1">{value}</p></div>
              ))}
            </div>
            <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="px-4 py-2 text-left">Product</th><th className="px-4 py-2 text-left">SKU</th><th className="px-4 py-2 text-left">Category</th><th className="px-4 py-2 text-right">Stock</th><th className="px-4 py-2 text-right">Reorder</th><th className="px-4 py-2 text-right">Sold</th><th className="px-4 py-2 text-right">Revenue</th><th className="px-4 py-2 text-right">Value</th><th className="px-4 py-2 text-center">Status</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {stockData.products?.map((p: any) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2 text-gray-500">{p.sku}</td><td className="px-4 py-2 text-gray-500">{p.category || '"'}</td><td className="px-4 py-2 text-right">{p.current_stock}</td><td className="px-4 py-2 text-right">{p.reorder_level}</td><td className="px-4 py-2 text-right">{p.units_sold}</td><td className="px-4 py-2 text-right">{fmt(p.revenue || 0)}</td><td className="px-4 py-2 text-right">{fmt(p.stock_value)}</td>
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

      {/* Cashup History */}
      {tab === 'Cashup History' && (
        loadingCashup
          ? <div className="bg-gray-100 rounded-md h-32 animate-pulse" />
          : cashupRecords.length === 0
            ? <div className="bg-white rounded-md border border-gray-100 p-12 text-center text-gray-400">No cashup records for this period.</div>
            : (
              <div className="space-y-4">
                {/* Summary strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    ['Total Shifts', String(cashupRecords.length)],
                    ['Total Sales', fmt(cashupRecords.reduce((s, r) => s + (r.total_sales || 0), 0))],
                    ['Total Expected Cash', fmt(cashupRecords.reduce((s, r) => s + (r.expected_cash || 0), 0))],
                    ['Total Declared Cash', fmt(cashupRecords.reduce((s, r) => s + (r.declared_cash || 0), 0))],
                  ].map(([label, val]) => (
                    <div key={label} className="bg-white border border-gray-200 rounded-md p-4">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="text-lg font-bold text-gray-900 mt-1">{val}</p>
                    </div>
                  ))}
                </div>
                {/* Net variance card */}
                {(() => {
                  const totalVar = cashupRecords.reduce((s, r) => s + (r.variance || 0), 0);
                  return (
                    <div className={`flex items-center justify-between rounded-md border px-5 py-3 text-sm font-semibold ${totalVar >= 0 ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                      <span>Net Cash Variance (all shifts)</span>
                      <span>{totalVar >= 0 ? '+' : ''}{fmt(totalVar)}</span>
                    </div>
                  );
                })()}
                {/* Table */}
                <div className="bg-white rounded-md border border-gray-100 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                        <tr>
                          <th className="px-4 py-3 text-left">Cashier</th>
                          <th className="px-4 py-3 text-left">Branch</th>
                          <th className="px-4 py-3 text-left">Shift Start</th>
                          <th className="px-4 py-3 text-left">Shift End</th>
                          <th className="px-4 py-3 text-right">Txns</th>
                          <th className="px-4 py-3 text-right">Total Sales</th>
                          <th className="px-4 py-3 text-right">Cash Sales</th>
                          <th className="px-4 py-3 text-right">Expected</th>
                          <th className="px-4 py-3 text-right">Declared</th>
                          <th className="px-4 py-3 text-right">Variance</th>
                          <th className="px-4 py-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {cashupRecords.map((r: any) => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">{r.user?.name ?? '-'}</p>
                              <p className="text-xs text-gray-400">@{r.user?.username}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-600 text-xs">{r.branch?.name ?? '-'}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(r.shift_start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(r.shift_end).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">{r.total_transactions}</td>
                            <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(r.total_sales)}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{fmt(r.cash_sales ?? 0)}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{fmt(r.expected_cash)}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{fmt(r.declared_cash)}</td>
                            <td className={`px-4 py-3 text-right font-bold ${r.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {r.variance >= 0 ? '+' : ''}{fmt(r.variance)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                                r.status === 'approved' ? 'bg-green-100 text-green-700'
                                : r.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                              }`}>{r.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr className="font-bold">
                          <td colSpan={4} className="px-4 py-3 text-gray-700 text-right">TOTALS</td>
                          <td className="px-4 py-3 text-right">{cashupRecords.reduce((s, r) => s + r.total_transactions, 0)}</td>
                          <td className="px-4 py-3 text-right">{fmt(cashupRecords.reduce((s, r) => s + r.total_sales, 0))}</td>
                          <td className="px-4 py-3 text-right">{fmt(cashupRecords.reduce((s, r) => s + (r.cash_sales ?? 0), 0))}</td>
                          <td className="px-4 py-3 text-right">{fmt(cashupRecords.reduce((s, r) => s + r.expected_cash, 0))}</td>
                          <td className="px-4 py-3 text-right">{fmt(cashupRecords.reduce((s, r) => s + r.declared_cash, 0))}</td>
                          {(() => {
                            const v = cashupRecords.reduce((s, r) => s + r.variance, 0);
                            return <td className={`px-4 py-3 text-right ${v >= 0 ? 'text-green-600' : 'text-red-600'}`}>{v >= 0 ? '+' : ''}{fmt(v)}</td>;
                          })()}
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )
      )}

      {/* Branch Consolidation */}
      {tab === 'Branch Consolidation' && (
        loadingConsolidation ? <div className="bg-gray-100 rounded-md h-32 animate-pulse"/> :
        consolidationData ? (
          <div className="space-y-4">
            {/* Totals */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[['Total Sales', consolidationData.totals?.sales, 'text-blue-600'], ['Total Gross Profit', consolidationData.totals?.gross_profit, 'text-green-600'], ['Total Expenses', consolidationData.totals?.expenses, 'text-red-600'], ['Total Net Profit', consolidationData.totals?.net_profit, consolidationData.totals?.net_profit >= 0 ? 'text-green-600' : 'text-red-600']].map(([label, val, color]) => (
                <div key={label as string} className="bg-white rounded-md border border-gray-100 p-4 shadow-sm">
                  <p className="text-xs text-gray-500">{label as string}</p>
                  <p className={`text-xl font-bold mt-1 ${color}`}>{fmt(Number(val) || 0)}</p>
                </div>
              ))}
            </div>

            {/* Branch comparison table */}
            <div className="bg-white rounded-md border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-800">
                Branch Performance " {from} to {to}
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
                        <td className="px-4 py-3">"</td>
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
