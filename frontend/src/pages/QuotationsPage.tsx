import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { useCurrencyStore } from '../stores/currencyStore';
import { Plus, X, FileText, Send, Check, XCircle } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import toast from 'react-hot-toast';

const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'];
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
};

type QuotationItem = { name: string; quantity: string; unit_price: string; discount: string; tax_amount: string };

export default function QuotationsPage() {
  const { format } = useCurrencyStore();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ notes: '', valid_until: '', items: [{ name: '', quantity: '1', unit_price: '', discount: '0', tax_amount: '0' }] as QuotationItem[] });

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', filterStatus, page],
    queryFn: () => api.get('/quotations', { params: { status: filterStatus || undefined, page, per_page: 20 } }).then(r => r.data?.data),
  });

  const { data: quotationDetail } = useQuery({
    queryKey: ['quotation', selected?.id],
    queryFn: () => api.get(`/quotations/${selected.id}`).then(r => r.data?.data),
    enabled: !!selected?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/quotations', data),
    onSuccess: () => { toast.success('Quotation created!'); qc.invalidateQueries({ queryKey: ['quotations'] }); setShowNew(false); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: any) => api.put(`/quotations/${id}`, { status }),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['quotation', selected?.id] }); qc.invalidateQueries({ queryKey: ['quotations'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/quotations/${id}`),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['quotations'] }); setSelected(null); },
  });

  const quotations: any[] = data?.data ?? (Array.isArray(data) ? data : []);
  const meta = data?.meta ?? (data?.last_page ? { current_page: data.current_page, last_page: data.last_page, from: data.from, to: data.to, total: data.total } : null);

  const updateItem = (idx: number, field: keyof QuotationItem, value: string) =>
    setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [field]: value } : it) }));

  const calcTotal = () => form.items.reduce((s, i) => {
    const sub = parseFloat(i.unit_price || '0') * parseFloat(i.quantity || '1');
    return s + sub + parseFloat(i.tax_amount || '0') - parseFloat(i.discount || '0');
  }, 0);

  const handleCreate = () => {
    const items = form.items.filter(i => i.name && i.unit_price);
    if (!items.length) { toast.error('Add at least one item'); return; }
    createMutation.mutate({ valid_until: form.valid_until || null, notes: form.notes || null, items });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quotations</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage price quotes for customers</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700">
          <Plus size={16} /> New Quotation
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => { setFilterStatus(''); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${!filterStatus ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>All</button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => { setFilterStatus(s); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${filterStatus === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{s}</button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : quotations.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><FileText size={32} className="mx-auto mb-2" /><p>No quotations found</p></div>
        ) : (
          <>
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Reference</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-left px-4 py-3">Valid Until</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {quotations.map((q: any) => (
                <tr key={q.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(q)}>
                  <td className="px-4 py-3 font-mono text-sm text-gray-700">{q.reference}</td>
                  <td className="px-4 py-3 text-sm text-gray-800">{q.customer?.name ?? 'Walk-in'}</td>
                  <td className="px-4 py-3 text-sm font-bold text-right">{format(q.total)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{q.valid_until ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[q.status]}`}>{q.status}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(q.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={e => { e.stopPropagation(); deleteMutation.mutate(q.id); }} className="text-gray-300 hover:text-red-500 transition-colors"><X size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
          </>
        )}
      </div>

      {/* New Quotation Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">New Quotation</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Valid Until</label>
                  <input type="date" value={form.valid_until} onChange={e => setForm({...form, valid_until: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Line Items</label>
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-12 gap-1 text-xs text-gray-400 font-semibold px-1">
                    <span className="col-span-4">Item</span><span className="col-span-2">Qty</span><span className="col-span-2">Price</span><span className="col-span-2">Disc</span><span className="col-span-2">Tax</span>
                  </div>
                  {form.items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-1 items-center">
                      <input value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)} placeholder="Item name" className="col-span-4 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="number" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="number" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="number" value={item.discount} onChange={e => updateItem(idx, 'discount', e.target.value)} className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <div className="col-span-1"><input type="number" value={item.tax_amount} onChange={e => updateItem(idx, 'tax_amount', e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                      {form.items.length > 1 && <button onClick={() => setForm(f => ({...f, items: f.items.filter((_,i) => i!==idx)}))} className="text-red-400 hover:text-red-600"><X size={12} /></button>}
                    </div>
                  ))}
                  <button onClick={() => setForm(f => ({...f, items: [...f.items, {name:'',quantity:'1',unit_price:'',discount:'0',tax_amount:'0'}]}))} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={12} />Add item</button>
                </div>
              </div>

              <div className="flex justify-between items-center font-bold text-lg border-t pt-3">
                <span>Total</span>
                <span className="text-blue-600">{format(calcTotal())}</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" rows={2} />
              </div>

              <button onClick={handleCreate} disabled={createMutation.isPending} className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Create Quotation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selected && quotationDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900">{quotationDetail.reference}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[quotationDetail.status]}`}>{quotationDetail.status}</span>
              </div>
              <button onClick={() => setSelected(null)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-400 uppercase border-b"><th className="text-left pb-2">Item</th><th className="text-right pb-2">Qty</th><th className="text-right pb-2">Price</th><th className="text-right pb-2">Total</th></tr></thead>
                <tbody>
                  {quotationDetail.items?.map((it: any) => (
                    <tr key={it.id} className="border-b border-gray-50">
                      <td className="py-2">{it.name}</td>
                      <td className="py-2 text-right">{it.quantity}</td>
                      <td className="py-2 text-right">{format(it.unit_price)}</td>
                      <td className="py-2 text-right font-semibold">{format(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-between font-bold text-lg"><span>Total</span><span className="text-blue-600">{format(quotationDetail.total)}</span></div>

              {quotationDetail.status === 'draft' && (
                <div className="flex gap-2">
                  <button onClick={() => updateMutation.mutate({ id: quotationDetail.id, status: 'sent' })} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700">
                    <Send size={14} /> Mark as Sent
                  </button>
                  <button onClick={() => updateMutation.mutate({ id: quotationDetail.id, status: 'accepted' })} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700">
                    <Check size={14} /> Accept
                  </button>
                  <button onClick={() => updateMutation.mutate({ id: quotationDetail.id, status: 'declined' })} className="flex items-center justify-center gap-2 px-4 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50">
                    <XCircle size={14} /> Decline
                  </button>
                </div>
              )}
              {quotationDetail.status === 'sent' && (
                <div className="flex gap-2">
                  <button onClick={() => updateMutation.mutate({ id: quotationDetail.id, status: 'accepted' })} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700"><Check size={14} /> Accept</button>
                  <button onClick={() => updateMutation.mutate({ id: quotationDetail.id, status: 'declined' })} className="flex items-center justify-center gap-2 px-4 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50"><XCircle size={14} /> Decline</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
