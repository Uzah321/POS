import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { Plus, X, ArrowRightLeft, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  in_transit: 'bg-blue-100 text-blue-700',
  received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function StockTransferPage() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ from_branch_id: '', to_branch_id: '', notes: '', items: [{ product_id: '', quantity: '1' }] });

  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfers', filterStatus],
    queryFn: () => api.get('/stock-transfers', { params: { status: filterStatus || undefined } }).then(r => r.data?.data),
  });

  const { data: transferDetail } = useQuery({
    queryKey: ['stock-transfer', selected?.id],
    queryFn: () => api.get(`/stock-transfers/${selected.id}`).then(r => r.data?.data),
    enabled: !!selected?.id,
  });

  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data?.data?.data ?? r.data?.data ?? []),
  });

  const { data: products } = useQuery({
    queryKey: ['products-list'],
    queryFn: () => api.get('/products', { params: { per_page: 200 } }).then(r => r.data?.data?.data ?? []),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/stock-transfers', data),
    onSuccess: () => { toast.success('Transfer created!'); qc.invalidateQueries({ queryKey: ['stock-transfers'] }); setShowNew(false); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) => api.post(`/stock-transfers/${id}/${action}`),
    onSuccess: (_, vars) => {
      toast.success(`Transfer ${vars.action === 'dispatch' ? 'dispatched' : vars.action === 'receive' ? 'received' : 'cancelled'}!`);
      qc.invalidateQueries({ queryKey: ['stock-transfer', selected?.id] });
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const transfers: any[] = data?.data ?? data ?? [];
  const branchList: any[] = branches ?? [];
  const productList: any[] = products ?? [];

  const handleCreate = () => {
    const items = form.items.filter(i => i.product_id && parseFloat(i.quantity) > 0);
    if (!items.length || !form.from_branch_id || !form.to_branch_id) { toast.error('Fill all required fields'); return; }
    createMutation.mutate({ from_branch_id: parseInt(form.from_branch_id), to_branch_id: parseInt(form.to_branch_id), notes: form.notes || null, items: items.map(i => ({ product_id: parseInt(i.product_id), quantity: parseFloat(i.quantity) })) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Transfers</h1>
          <p className="text-sm text-gray-500 mt-1">Move stock between branches</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700">
          <Plus size={16} /> New Transfer
        </button>
      </div>

      <div className="flex gap-2">
        {['', 'pending', 'in_transit', 'received', 'cancelled'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${filterStatus === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{s || 'All'}</button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : transfers.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><ArrowRightLeft size={32} className="mx-auto mb-2" /><p>No transfers</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Reference</th>
                <th className="text-left px-4 py-3">From</th>
                <th className="text-left px-4 py-3">To</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transfers.map((t: any) => (
                <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(t)}>
                  <td className="px-4 py-3 font-mono text-sm">{t.reference}</td>
                  <td className="px-4 py-3 text-sm">{t.from_branch?.name}</td>
                  <td className="px-4 py-3 text-sm">{t.to_branch?.name}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[t.status]}`}>{t.status.replace('_',' ')}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-300">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New Transfer Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-gray-900">New Transfer</h2>
              <button onClick={() => setShowNew(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">From Branch</label>
                  <select value={form.from_branch_id} onChange={e => setForm({...form, from_branch_id: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select...</option>
                    {branchList.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">To Branch</label>
                  <select value={form.to_branch_id} onChange={e => setForm({...form, to_branch_id: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select...</option>
                    {branchList.filter((b: any) => b.id !== parseInt(form.from_branch_id)).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Items</label>
                {form.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mt-1">
                    <select value={item.product_id} onChange={e => setForm(f => ({...f, items: f.items.map((it,i) => i===idx ? {...it, product_id: e.target.value} : it)}))} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select product...</option>
                      {productList.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="number" value={item.quantity} onChange={e => setForm(f => ({...f, items: f.items.map((it,i) => i===idx ? {...it, quantity: e.target.value} : it)}))} className="w-20 border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Qty" />
                    {form.items.length > 1 && <button onClick={() => setForm(f => ({...f, items: f.items.filter((_,i) => i!==idx)}))} className="text-red-400"><X size={14} /></button>}
                  </div>
                ))}
                <button onClick={() => setForm(f => ({...f, items: [...f.items, {product_id:'',quantity:'1'}]}))} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={12} />Add item</button>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" rows={2} />
              </div>
              <button onClick={handleCreate} disabled={createMutation.isPending} className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Create Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selected && transferDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="font-bold text-gray-900">{transferDetail.reference}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[transferDetail.status]}`}>{transferDetail.status.replace('_',' ')}</span>
              </div>
              <button onClick={() => setSelected(null)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 text-sm font-medium">
                <span className="bg-gray-100 px-3 py-1.5 rounded-lg">{transferDetail.from_branch?.name}</span>
                <ArrowRightLeft size={16} className="text-gray-400" />
                <span className="bg-gray-100 px-3 py-1.5 rounded-lg">{transferDetail.to_branch?.name}</span>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-400 uppercase border-b"><th className="text-left pb-2">Product</th><th className="text-right pb-2">Qty</th></tr></thead>
                <tbody>
                  {transferDetail.items?.map((it: any) => (
                    <tr key={it.id} className="border-b border-gray-50"><td className="py-2">{it.product?.name}</td><td className="py-2 text-right font-semibold">{it.quantity}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2 flex-wrap">
                {transferDetail.status === 'pending' && (
                  <button onClick={() => actionMutation.mutate({ id: transferDetail.id, action: 'dispatch' })} disabled={actionMutation.isPending} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                    {actionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Dispatch
                  </button>
                )}
                {transferDetail.status === 'in_transit' && (
                  <button onClick={() => actionMutation.mutate({ id: transferDetail.id, action: 'receive' })} disabled={actionMutation.isPending} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1">
                    {actionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Receive
                  </button>
                )}
                {(transferDetail.status === 'pending' || transferDetail.status === 'in_transit') && (
                  <button onClick={() => actionMutation.mutate({ id: transferDetail.id, action: 'cancel' })} disabled={actionMutation.isPending} className="px-4 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50 disabled:opacity-50">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
