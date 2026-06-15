import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stockReconciliationApi, branchesApi, warehousesApi } from '../api';
import { Download, Loader2, AlertTriangle, CheckCircle, Package, ClipboardCheck, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { format, startOfWeek, endOfWeek } from 'date-fns';

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.URL.revokeObjectURL(url);
}

const STATUS_STYLES: Record<string, string> = {
  ok:    'bg-green-100 text-green-700',
  short: 'bg-red-100 text-red-700',
  over:  'bg-yellow-100 text-yellow-700',
};

export default function StockReconciliationPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [dateTo, setDateTo]     = useState(format(today, 'yyyy-MM-dd'));
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAll, setShowAll]   = useState(false);
  const [autoLoad, setAutoLoad] = useState(true);

  const { data: branchData }    = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []) });
  const { data: warehouseData } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list().then(r => r.data?.data || []) });
  const branches   = branchData || [];
  const warehouses = warehouseData || [];

  const params = {
    date_from:    dateFrom,
    date_to:      dateTo,
    branch_id:    branchId || undefined,
    warehouse_id: warehouseId || undefined,
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['stock-reconciliation', params],
    queryFn: () => stockReconciliationApi.reconcile(params).then(r => r.data?.data),
    enabled: autoLoad,
  });

  const setThisWeek = () => {
    setDateFrom(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    setDateTo(format(today, 'yyyy-MM-dd'));
  };
  const setLastWeek = () => {
    const last = new Date(today); last.setDate(today.getDate() - 7);
    setDateFrom(format(startOfWeek(last, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    setDateTo(format(endOfWeek(last, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  };

  const handleExport = async () => {
    try {
      const res = await stockReconciliationApi.exportCsv(params);
      downloadBlob(res.data, `stock-reconciliation-${dateFrom}-${dateTo}.csv`);
    } catch { toast.error('Export failed'); }
  };

  const summary  = data?.summary;
  const allRows  = data?.products || [];
  const rows = filterStatus ? allRows.filter((r: any) => r.status === filterStatus) : (showAll ? allRows : allRows.filter((r: any) => r.status !== 'ok'));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Reconciliation</h1>
          <p className="text-gray-500 text-sm">Opening Stock + Purchases - Sales = Expected vs Actual</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => navigate('/stocktake')} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-2 rounded-md text-sm">
            <ClipboardCheck size={14} /> Start Stocktake
          </button>
          <button type="button" onClick={handleExport} className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-md text-sm hover:bg-gray-50">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Weekly stocktake warning */}
      {summary?.stocktake_warning && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800">
              {summary.last_stocktake_date
                ? `Last stocktake was ${summary.days_since_last_stocktake} days ago (${summary.last_stocktake_date})`
                : 'No stocktake has been conducted yet'}
            </p>
            <p className="text-sm text-amber-700 mt-0.5">
              Stocktakes should be done every week. Without a stocktake, reconciliation uses system stock quantities as the actual count.
              <button type="button" onClick={() => navigate('/stocktake')} className="ml-2 underline font-medium hover:text-amber-900">Conduct stocktake now â†'</button>
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-md border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Quick Select</label>
            <div className="flex gap-2">
              <button type="button" onClick={setThisWeek} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700">This Week</button>
              <button type="button" onClick={setLastWeek} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Last Week</button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Branch</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">All branches</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">All warehouses</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => { setAutoLoad(true); refetch(); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            <RefreshCw size={14} /> Run
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={32} className="animate-spin text-blue-500" />
          <p className="text-gray-500 text-sm">Calculating stock reconciliation...</p>
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total Products', value: summary?.total_products, color: 'text-gray-900', bg: 'bg-white' },
              { label: 'Balanced (OK)', value: summary?.products_ok, color: 'text-green-700', bg: 'bg-green-50' },
              { label: 'Short (Missing)', value: summary?.products_short, color: 'text-red-700', bg: 'bg-red-50' },
              { label: 'Over (Excess)', value: summary?.products_over, color: 'text-yellow-700', bg: 'bg-yellow-50' },
              { label: 'Variance Value', value: `$${Number(summary?.total_variance_value || 0).toFixed(2)}`, color: 'text-orange-700', bg: 'bg-orange-50' },
            ].map(c => (
              <div key={c.label} className={`${c.bg} rounded-md border border-gray-100 p-4 shadow-sm`}>
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {!summary?.has_period_stocktake && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-700 flex items-center gap-2">
              <ClipboardCheck size={16} />
              <span>No stocktake found for this period " actual stock shows <strong>current system quantities</strong>. Conduct a stocktake for accurate counts.</span>
              {summary?.period_stocktake_ref && <span className="ml-2 font-mono text-xs">{summary.period_stocktake_ref}</span>}
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-md border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                {[['', 'Variances Only'], ['ok', 'OK'], ['short', 'Short'], ['over', 'Over']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => { setFilterStatus(v); setShowAll(v === ''); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${filterStatus === v && (v !== '' || !showAll) ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {l}
                  </button>
                ))}
                <button type="button" onClick={() => { setFilterStatus(''); setShowAll(true); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${showAll && !filterStatus ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  All Products
                </button>
              </div>
              <span className="text-xs text-gray-400 ml-auto">{rows.length} products shown</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {['Product', 'SKU', 'Category', 'Opening Stock', '+ Purchases', '- Sales', '= Expected', 'Actual Stock', 'Variance', 'Var. Value', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-12 text-gray-400">
                        <CheckCircle size={32} className="mx-auto mb-2 text-green-400" />
                        <p>All products balanced " no variances found</p>
                      </td>
                    </tr>
                  ) : rows.map((r: any) => (
                    <tr key={r.product_id} className={`hover:bg-gray-50 ${r.status === 'short' ? 'bg-red-50/30' : r.status === 'over' ? 'bg-yellow-50/30' : ''}`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[180px] truncate">{r.product_name}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{r.sku}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{r.category}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">{r.opening_stock}</td>
                      <td className="px-4 py-3 text-sm text-green-700 tabular-nums">+{r.purchases}</td>
                      <td className="px-4 py-3 text-sm text-red-600 tabular-nums">-{r.sales}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 tabular-nums">{Number(r.expected_stock).toFixed(2)}</td>
                      <td className={`px-4 py-3 text-sm font-semibold tabular-nums ${r.has_stocktake ? 'text-blue-700' : 'text-gray-700'}`}>{r.actual_stock}</td>
                      <td className={`px-4 py-3 text-sm font-bold tabular-nums ${r.variance < 0 ? 'text-red-600' : r.variance > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {r.variance > 0 ? '+' : ''}{Number(r.variance).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-orange-700 tabular-nums">${Number(r.variance_value).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${STATUS_STYLES[r.status]}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex gap-6 flex-wrap">
              <span><strong className="text-blue-700">Blue actual</strong> = from a stocktake count</span>
              <span><strong className="text-gray-700">Gray actual</strong> = current system stock (no stocktake)</span>
              <span><strong className="text-red-600">Short</strong> = stock missing (theft/damage)</span>
              <span><strong className="text-yellow-600">Over</strong> = unrecorded additions</span>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-md border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 text-gray-400">
          <Package size={40} className="mb-3" />
          <p className="text-sm">Click "Run" to calculate stock reconciliation for the selected period</p>
        </div>
      )}
    </div>
  );
}
