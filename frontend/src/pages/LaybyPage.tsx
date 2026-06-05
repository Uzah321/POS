import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { useCurrencyStore } from '../stores/currencyStore';
import { Plus, X, ChevronRight, CreditCard, Package } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUSES = ['pending', 'partial', 'complete', 'cancelled'];
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  partial: 'bg-blue-100 text-blue-700',
  complete: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function LaybyPage() {
  const { format } = useCurrencyStore();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [selectedLayby, setSelectedLayby] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');

  // New layby form
  const [form, setForm] = useState({ customer_name: '', total: '', deposit_paid: '', due_date: '', notes: '', items: [{ name: '', quantity: 1, unit_price: '' }] });

  const { data, isLoading } = useQuery({
    queryKey: ['laybys', filterStatus],
    queryFn: () => api.get('/laybys', { params: { status: filterStatus || undefined } }).then(r => r.data?.data),
  });

  const { data: laybyDetail } = useQuery({
    queryKey: ['layby', selectedLayby?.id],
    queryFn: () => api.get(`/laybys/${selectedLayby.id}`).then(r => r.data?.data),
    enabled: !!selectedLayby?.id,
  });

  useQuery({
    queryKey: ['customers-list'],
    queryFn: () => api.get('/customers', { params: { per_page: 200 } }).then(r => r.data?.data?.data ?? []),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/laybys', data),
    onSuccess: () => { toast.success('Layby created!'); qc.invalidateQueries({ queryKey: ['laybys'] }); setShowNew(false); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.post(`/laybys/${id}/payment`, data),
    onSuccess: () => { toast.success('Payment added!'); qc.invalidateQueries({ queryKey: ['layby', selectedLayby?.id] }); qc.invalidateQueries({ queryKey: ['laybys'] }); setPaymentAmount(''); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.post(`/laybys/${id}/cancel`),
    onSuccess: () => { toast.success('Layby cancelled'); qc.invalidateQueries({ queryKey: ['laybys'] }); setSelectedLayby(null); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Cannot cancel'),
  });

  const laybys: any[] = data?.data ?? data ?? [];

  const handleCreate = () => {
    const items = form.items.filter(i => i.name && i.unit_price);
    if (!items.length) { toast.error('Add at least one item'); return; }
    createMutation.mutate({
      total: parseFloat(form.total),
      deposit_paid: parseFloat(form.deposit_paid || '0'),
      due_date: form.due_date || null,
      notes: form.notes || null,
      items,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Layby / Layaway</h1>
          <p className="text-sm text-gray-500 mt-1">Manage deferred payment plans</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
          <Plus size={16} /> New Layby
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterStatus('')} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${!filterStatus ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>All</button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize ${filterStatus === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{s}</button>
        ))}
      </div>

      {/* Laybys list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : laybys.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><Package size={32} className="mx-auto mb-2" /><p>No laybys found</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Reference</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Balance</th>
                <th className="text-left px-4 py-3">Due</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {laybys.map((l: any) => (
                <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm text-gray-700">{l.reference}</td>
                  <td className="px-4 py-3 text-sm text-gray-800">{l.customer?.name ?? 'Walk-in'}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold">{format(l.total)}</td>
                  <td className="px-4 py-3 text-sm text-right text-emerald-600">{format(l.deposit_paid)}</td>
                  <td className="px-4 py-3 text-sm text-right text-amber-600 font-semibold">{format(l.balance)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{l.due_date ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[l.status]}`}>{l.status}</span></td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedLayby(l)} className="text-gray-400 hover:text-blue-600 transition-colors"><ChevronRight size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New Layby Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">New Layby</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Total Amount</label>
                  <input type="number" value={form.total} onChange={e => setForm({...form, total: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Deposit</label>
                  <input type="number" value={form.deposit_paid} onChange={e => setForm({...form, deposit_paid: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Items</label>
                {form.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mt-1">
                    <input value={item.name} onChange={e => setForm({...form, items: form.items.map((it, i) => i === idx ? {...it, name: e.target.value} : it)})} placeholder="Item name" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="number" value={item.quantity} onChange={e => setForm({...form, items: form.items.map((it, i) => i === idx ? {...it, quantity: parseFloat(e.target.value)} : it)})} className="w-16 border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Qty" />
                    <input type="number" value={item.unit_price} onChange={e => setForm({...form, items: form.items.map((it, i) => i === idx ? {...it, unit_price: e.target.value} : it)})} className="w-24 border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Price" />
                    {form.items.length > 1 && <button onClick={() => setForm({...form, items: form.items.filter((_,i) => i!==idx)})} className="text-red-400 hover:text-red-600"><X size={14} /></button>}
                  </div>
                ))}
                <button onClick={() => setForm({...form, items: [...form.items, {name: '', quantity: 1, unit_price: ''}]})} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={12} />Add item</button>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" rows={2} />
              </div>
              <button onClick={handleCreate} disabled={createMutation.isPending} className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Create Layby'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layby Detail Modal */}
      {selectedLayby && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900">{laybyDetail?.reference ?? selectedLayby.reference}</h2>
                <p className="text-xs text-gray-400">{laybyDetail?.customer?.name ?? 'Walk-in'}</p>
              </div>
              <button onClick={() => setSelectedLayby(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {laybyDetail && (
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center"><p className="text-xs text-gray-400">Total</p><p className="font-bold text-gray-900">{format(laybyDetail.total)}</p></div>
                  <div className="bg-emerald-50 rounded-xl p-3 text-center"><p className="text-xs text-emerald-500">Paid</p><p className="font-bold text-emerald-700">{format(laybyDetail.deposit_paid)}</p></div>
                  <div className="bg-amber-50 rounded-xl p-3 text-center"><p className="text-xs text-amber-500">Balance</p><p className="font-bold text-amber-700">{format(laybyDetail.balance)}</p></div>
                </div>

                {laybyDetail.status !== 'complete' && laybyDetail.status !== 'cancelled' && (
                  <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Add Payment</p>
                    <div className="flex gap-2">
                      <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="mobile_money">Mobile</option>
                      </select>
                      <input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder={`Max ${format(laybyDetail.balance)}`} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <button onClick={() => paymentMutation.mutate({ id: laybyDetail.id, data: { amount: parseFloat(paymentAmount), method: paymentMethod } })} disabled={!paymentAmount || paymentMutation.isPending} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
                        <CreditCard size={14} /> Pay
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Payment History</p>
                  {(laybyDetail.payments ?? []).length === 0 ? (
                    <p className="text-sm text-gray-400">No payments yet</p>
                  ) : (
                    <div className="space-y-2">
                      {laybyDetail.payments.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 text-sm">
                          <div><span className="font-medium text-gray-700 capitalize">{p.method}</span>{p.notes && <span className="text-gray-400 ml-2 text-xs">{p.notes}</span>}</div>
                          <span className="font-bold text-emerald-600">{format(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {laybyDetail.status !== 'cancelled' && laybyDetail.status !== 'complete' && (
                  <button onClick={() => cancelMutation.mutate(laybyDetail.id)} disabled={cancelMutation.isPending} className="w-full py-2 border-2 border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50">Cancel Layby</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
