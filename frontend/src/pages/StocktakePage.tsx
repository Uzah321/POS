import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { useAuthStore } from '../stores/authStore';
import { Plus, X, ClipboardCheck, Check, AlertCircle, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

export default function StocktakePage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any>(null);
  const [countSheet, setCountSheet] = useState<Record<number, string>>({});
  const [filterStatus, setFilterStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['stocktakes', filterStatus],
    queryFn: () => api.get('/stocktakes', { params: { status: filterStatus || undefined } }).then(r => r.data?.data),
  });

  const { data: stocktakeDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['stocktake', selected?.id],
    queryFn: async () => {
      const res = await api.get(`/stocktakes/${selected.id}`);
      const d = res.data?.data;
      const counts: Record<number, string> = {};
      d?.items?.forEach((it: any) => { counts[it.id] = it.counted_qty ?? ''; });
      setCountSheet(counts);
      return d;
    },
    enabled: !!selected?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => offlineMutate(() => api.post('/stocktakes', { branch_id: user?.branch?.id }), 'stocktakes', 'create', { branch_id: user?.branch?.id }),
    onSuccess: (result) => {
      if (result.offline) toast.success('Stocktake queued offline — will sync when server is back');
      else { toast.success('Stocktake created!'); qc.invalidateQueries({ queryKey: ['stocktakes'] }); const d = (result as any).data?.data; if (d) setSelected(d); }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, items }: any) => offlineMutate(() => api.put(`/stocktakes/${id}`, { items }), 'stocktakes', 'update', { items }, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Counts saved offline — will sync when server is back');
      else { toast.success('Counts saved!'); qc.invalidateQueries({ queryKey: ['stocktake', selected?.id] }); }
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => offlineMutate(() => api.post(`/stocktakes/${id}/complete`), 'stocktakes', 'complete', { _url: `/stocktakes/${id}/complete`, _method: 'POST' }, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Completion queued offline — will sync when server is back');
      else { toast.success('Stocktake completed - stock levels updated!'); qc.invalidateQueries({ queryKey: ['stocktakes'] }); qc.invalidateQueries({ queryKey: ['stocktake', selected?.id] }); }
    },
  });

  const stocktakes: any[] = data?.data ?? data ?? [];

  const handleSaveCounts = () => {
    if (!stocktakeDetail) return;
    const items = stocktakeDetail.items.map((it: any) => ({ id: it.id, counted_qty: parseFloat(countSheet[it.id] ?? it.counted_qty ?? '0') }));
    updateMutation.mutate({ id: stocktakeDetail.id, items });
  };

  const variances = stocktakeDetail?.items?.filter((it: any) => it.counted_qty !== null && it.variance !== 0 && it.variance !== null) ?? [];

  const downloadCountSheet = () => {
    if (!stocktakeDetail) return;
    const ref = stocktakeDetail.reference ?? selected?.reference ?? 'stocktake';
    const date = new Date().toLocaleDateString();
    const rows = stocktakeDetail.items ?? [];

    // Build CSV
    const csvLines = [
      `Stocktake Count Sheet`,
      `Reference: ${ref}`,
      `Date: ${date}`,
      `Branch: ${stocktakeDetail.branch?.name ?? '-'}`,
      ``,
      `Product,SKU,Category,Expected Qty,Counted Qty,Variance,Notes`,
      ...rows.map((it: any) =>
        [
          `"${it.product?.name ?? ''}"`,
          `"${it.product?.sku ?? ''}"`,
          `"${it.product?.category?.name ?? ''}"`,
          it.expected_qty ?? '',
          '',   // Counted Qty — blank for physical counting
          '',   // Variance — filled in after count
          '',   // Notes
        ].join(',')
      ),
    ];
    const csvContent = csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `count-sheet-${ref}-${date.replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Count sheet downloaded');
  };

  const printCountSheet = () => {
    if (!stocktakeDetail) return;
    const ref = stocktakeDetail.reference ?? selected?.reference ?? 'stocktake';
    const date = new Date().toLocaleDateString();
    const rows: any[] = stocktakeDetail.items ?? [];
    const rowsHtml = rows.map((it: any, idx: number) => `
      <tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:6px 8px">${idx + 1}</td>
        <td style="padding:6px 8px">${it.product?.name ?? ''}</td>
        <td style="padding:6px 8px">${it.product?.sku ?? ''}</td>
        <td style="padding:6px 8px">${it.product?.category?.name ?? ''}</td>
        <td style="padding:6px 8px;text-align:center">${it.expected_qty ?? ''}</td>
        <td style="padding:6px 8px;min-width:60px">&nbsp;</td>
        <td style="padding:6px 8px;min-width:60px">&nbsp;</td>
        <td style="padding:6px 8px;min-width:80px">&nbsp;</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>Count Sheet - ${ref}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;padding:6px 8px;text-align:left;border-bottom:2px solid #d1d5db}@media print{button{display:none}}</style>
      </head><body>
      <h2 style="margin:0 0 4px">Stocktake Count Sheet</h2>
      <p style="margin:0 0 12px;color:#6b7280">Ref: ${ref} &nbsp;|&nbsp; Date: ${date} &nbsp;|&nbsp; Branch: ${stocktakeDetail.branch?.name ?? '-'}</p>
      <table>
        <thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Category</th><th>Expected</th><th>Counted</th><th>Variance</th><th>Notes</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin-top:24px;font-size:11px;color:#9ca3af">Cashier signature: _________________________ &nbsp;&nbsp; Date: _____________</p>
      </body></html>`;
    const win = window.open('', '_blank');
    if (!win) { toast.error('Pop-up blocked. Allow pop-ups and try again.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stocktake / Cycle Count</h1>
          <p className="text-sm text-gray-500 mt-1">Count stock and reconcile variances</p>
        </div>
        <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          <Plus size={16} /> Start New Count
        </button>
      </div>

      <div className="flex gap-2">
        {['', 'draft', 'in_progress', 'completed'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${filterStatus === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{s || 'All'}</button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : stocktakes.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><ClipboardCheck size={32} className="mx-auto mb-2" /><p>No stocktakes</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Reference</th>
                <th className="text-left px-4 py-3">Branch</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stocktakes.map((st: any) => (
                <tr key={st.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(st)}>
                  <td className="px-4 py-3 font-mono text-sm">{st.reference}</td>
                  <td className="px-4 py-3 text-sm">{st.branch?.name ?? '-'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[st.status]}`}>{st.status.replace('_',' ')}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(st.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-300">-</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Stocktake Detail */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-900">{stocktakeDetail?.reference ?? selected.reference}</h2>
                {stocktakeDetail && <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[stocktakeDetail.status]}`}>{stocktakeDetail.status.replace('_',' ')}</span>}
              </div>
              <div className="flex items-center gap-2">
                {stocktakeDetail && (
                  <>
                    <button
                      onClick={downloadCountSheet}
                      title="Download count sheet as CSV"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition-colors"
                    >
                      <Download size={13} /> CSV
                    </button>
                    <button
                      onClick={printCountSheet}
                      title="Print count sheet"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors"
                    >
                      <Download size={13} /> Print
                    </button>
                  </>
                )}
                <button onClick={() => setSelected(null)}><X size={20} className="text-gray-400" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {detailLoading ? <div className="text-center text-gray-400 py-8">Loading...</div> : (
                <div className="space-y-4">
                  {variances.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-2">
                      <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700"><strong>{variances.length} variance{variances.length > 1 ? 's' : ''} found.</strong> Review before completing.</p>
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-400 uppercase border-b">
                      <th className="text-left pb-2">Product</th>
                      <th className="text-right pb-2">Expected</th>
                      <th className="text-right pb-2">Counted</th>
                      <th className="text-right pb-2">Variance</th>
                    </tr></thead>
                    <tbody>
                      {stocktakeDetail?.items?.map((it: any) => (
                        <tr key={it.id} className={`border-b border-gray-50 ${it.variance && it.variance !== 0 ? 'bg-amber-50/50' : ''}`}>
                          <td className="py-2">{it.product?.name}</td>
                          <td className="py-2 text-right text-gray-500">{it.expected_qty}</td>
                          <td className="py-2 text-right">
                            {stocktakeDetail.status === 'completed' ? (
                              <span className="font-semibold">{it.counted_qty ?? '-'}</span>
                            ) : (
                              <input
                                type="number"
                                value={countSheet[it.id] ?? ''}
                                onChange={e => setCountSheet(cs => ({...cs, [it.id]: e.target.value}))}
                                className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0"
                              />
                            )}
                          </td>
                          <td className={`py-2 text-right font-semibold ${(it.variance ?? 0) < 0 ? 'text-red-600' : (it.variance ?? 0) > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {it.variance !== null ? (it.variance > 0 ? '+' : '') + it.variance : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {stocktakeDetail?.status !== 'completed' && (
              <div className="flex gap-3 px-6 py-4 border-t flex-shrink-0">
                <button onClick={handleSaveCounts} disabled={updateMutation.isPending} className="flex-1 flex items-center justify-center gap-2 py-2.5 border-2 border-blue-200 text-blue-600 rounded-md text-sm font-semibold hover:bg-blue-50 disabled:opacity-50">
                  Save Counts
                </button>
                <button onClick={() => completeMutation.mutate(stocktakeDetail.id)} disabled={completeMutation.isPending} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white rounded-md text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  <Check size={14} /> Complete & Update Stock
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
