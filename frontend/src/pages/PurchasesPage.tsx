import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi, suppliersApi, branchesApi } from '../api';
import { Plus, Search, CheckCircle, Loader2, X, Truck } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  ordered: 'bg-purple-100 text-purple-700',
  received: 'bg-green-100 text-green-700',
  partially_received: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-red-100 text-red-700',
};

const poSchema = z.object({ supplier_id: z.coerce.number().min(1), expected_date: z.string().optional(), notes: z.string().optional() });

function POModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [items, setItems] = useState([{ product_name: '', quantity: 1, unit_cost: 0 }]);
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-list'], queryFn: () => suppliersApi.list().then(r => r.data?.data?.data || r.data?.data || []) });
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(poSchema) });
  const mutation = useMutation({
    mutationFn: (d: any) => purchaseOrdersApi.create({ ...d, items }),
    onSuccess: () => { toast.success('Purchase order created'); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const addItem = () => setItems([...items, { product_name: '', quantity: 1, unit_cost: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, val: any) => setItems(items.map((it, idx) => idx === i ? { ...it, [field]: val } : it));
  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold">New Purchase Order</h2><button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button></div>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Supplier *</label>
              <select {...register('supplier_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">Select supplier...</option>{suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>{errors.supplier_id && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
            <div><label className="text-sm font-medium text-gray-700">Expected Date</label><input type="date" {...register('expected_date')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2"><label className="text-sm font-semibold text-gray-700">Order Items</label><button type="button" onClick={addItem} className="text-xs text-amber-600 hover:text-amber-800 font-medium">+ Add Item</button></div>
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                <input value={item.product_name} onChange={(e) => updateItem(i, 'product_name', e.target.value)} placeholder="Product name" className="col-span-5 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                <input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', +e.target.value)} placeholder="Qty" className="col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                <input type="number" step="0.01" value={item.unit_cost} onChange={(e) => updateItem(i, 'unit_cost', +e.target.value)} placeholder="Unit cost" className="col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                <button type="button" onClick={() => removeItem(i)} className="col-span-1 flex items-center justify-center text-red-400 hover:text-red-600"><X size={14} /></button>
              </div>
            ))}
            <div className="text-right text-sm font-semibold text-gray-700 mt-2">Total: <span className="text-amber-600">R {total.toFixed(2)}</span></div>
          </div>
          <div><label className="text-sm font-medium text-gray-700">Notes</label><textarea {...register('notes')} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}Create PO
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PurchasesPage() {
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const qc = useQueryClient();

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []), staleTime: 120000 });
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', search, branchId, page],
    queryFn: () => purchaseOrdersApi.list({ search, page, per_page: 20, ...(branchId ? { branch_id: Number(branchId) } : {}) }).then(r => r.data?.data),
  });
  const approveMutation = useMutation({
    mutationFn: (id: number) => purchaseOrdersApi.approve(id),
    onSuccess: () => { toast.success('PO approved'); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const orders = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1><p className="text-gray-500 text-sm">Manage stock replenishment orders</p></div>
        <button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-4 py-2.5 rounded-xl text-sm"><Plus size={16} /> New PO</button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search orders..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          {(branchData as any[] || []).length > 1 && (
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">All Branches</option>
              {(branchData as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        {isLoading ? <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50"><tr>{['Reference', 'Date', 'Supplier', 'Items', 'Total', 'Status', 'Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {orders.length === 0 ? <tr><td colSpan={7} className="text-center py-12 text-gray-400"><Truck size={32} className="mx-auto mb-2" /><p>No purchase orders</p></td></tr>
                  : orders.map((o: any) => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">{o.reference}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(o.created_at), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{o.supplier?.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{o.items_count || o.items?.length || '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-amber-600">R {parseFloat(o.total_amount || 0).toFixed(2)}</td>
                      <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status?.replace('_', ' ')}</span></td>
                      <td className="px-4 py-3">
                        {(o.status === 'draft' || o.status === 'pending') && (
                          <button type="button" onClick={() => { if (confirm('Approve this PO?')) approveMutation.mutate(o.id); }} title="Approve" className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"><CheckCircle size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>
      {showModal && <POModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
