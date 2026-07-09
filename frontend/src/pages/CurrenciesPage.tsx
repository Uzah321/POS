import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Star } from 'lucide-react';
import toast from 'react-hot-toast';
import { currenciesApi } from '../api';
import { offlineMutate, handleOfflineSuccess } from '../lib/offlineMutation';
import { useCurrencyStore } from '../stores/currencyStore';

const schema = z.object({
  code:          z.string().min(2).max(10).toUpperCase(),
  name:          z.string().min(2).max(100),
  symbol:        z.string().min(1).max(10),
  exchange_rate: z.coerce.number().min(0.000001, 'Must be > 0'),
  is_default:    z.boolean().optional(),
  is_active:     z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export default function CurrenciesPage() {
  const qc = useQueryClient();
  const { activeCurrency, setActiveCurrency, setCurrencies } = useCurrencyStore();
  const [editing, setEditing] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);

  const { data } = useQuery({
    queryKey: ['currencies-all'],
    queryFn: async () => {
      const res = await currenciesApi.all();
      const list = res.data.data ?? res.data;
      setCurrencies(list);
      return list;
    },
  });

  const currencies: any[] = data ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
  });

  const openAdd = () => { setEditing(null); reset({ is_active: true, is_default: false }); setShowModal(true); };
  const openEdit = (c: any) => {
    setEditing(c);
    reset({ code: c.code, name: c.name, symbol: c.symbol, exchange_rate: c.exchange_rate, is_default: c.is_default, is_active: c.is_active });
    setShowModal(true);
  };

  const save = useMutation({
    mutationFn: (d: FormData) => editing
      ? offlineMutate(() => currenciesApi.update(editing.id, d), 'currencies', 'update', d as any, editing.id)
      : offlineMutate(() => currenciesApi.create(d), 'currencies', 'create', d as any),
    onSuccess: (result, d) => {
      if (result.offline) { handleOfflineSuccess(qc, result, 'currencies', editing ? 'update' : 'create', d as any, editing?.id); toast.success('Saved offline — will sync when server is back'); }
      else { toast.success(editing ? 'Currency updated' : 'Currency added'); qc.invalidateQueries({ queryKey: ['currencies-all'] }); }
      setShowModal(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => offlineMutate(() => currenciesApi.delete(id), 'currencies', 'delete', {}, id),
    onSuccess: (result, id) => {
      if (result.offline) { handleOfflineSuccess(qc, result, 'currencies', 'delete', {}, id); toast.success('Deleted offline — will sync when server is back'); }
      else { toast.success('Currency removed'); qc.invalidateQueries({ queryKey: ['currencies-all'] }); }
    },
  });

  const onSubmit = (d: FormData) => save.mutate(d);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Currencies</h1>
          <p className="text-sm text-gray-500 mt-1">Manage exchange rates. Base currency is <strong>USD</strong>.</p>
        </div>
        <button type="button" onClick={openAdd} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-4 py-2 text-sm">
          <Plus size={16} /> Add Currency
        </button>
      </div>

      {/* Active currency banner */}
      <div className="bg-amber-50 border border-amber-200 px-4 py-3 mb-6 flex items-center gap-3">
        <Star size={16} className="text-amber-600" />
        <span className="text-sm text-amber-900">
          POS active currency: <strong>{activeCurrency?.name} ({activeCurrency?.symbol}{activeCurrency?.code})</strong>
          {activeCurrency?.code !== 'USD' && (
            <span className="ml-2 text-amber-700">— 1 USD = {activeCurrency?.exchange_rate} {activeCurrency?.code}</span>
          )}
        </span>
      </div>

      <div className="bg-white border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Symbol</th>
              <th className="px-4 py-3 text-right">Rate (per 1 USD)</th>
              <th className="px-4 py-3 text-center">Default</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Use in POS</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {currencies.map((c: any) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${activeCurrency?.code === c.code ? 'bg-amber-50' : ''}`}>
                <td className="px-4 py-3 font-mono font-bold text-gray-900">{c.code}</td>
                <td className="px-4 py-3 text-gray-700">{c.name}</td>
                <td className="px-4 py-3 font-medium">{c.symbol}</td>
                <td className="px-4 py-3 text-right font-mono">{Number(c.exchange_rate).toFixed(6)}</td>
                <td className="px-4 py-3 text-center">
                  {c.is_default && <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-semibold"><Star size={12} /> Default</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 text-xs font-semibold ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setActiveCurrency(c)}
                    disabled={activeCurrency?.code === c.code}
                    className={`px-3 py-1 text-xs font-semibold transition-colors ${activeCurrency?.code === c.code ? 'bg-amber-500 text-gray-900 cursor-default' : 'bg-gray-100 hover:bg-amber-100 text-gray-700'}`}
                  >
                    {activeCurrency?.code === c.code ? 'Active' : 'Select'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => openEdit(c)} className="text-gray-400 hover:text-blue-600 p-1"><Pencil size={14} /></button>
                    <button
                      type="button"
                      onClick={() => { if (!c.is_default && confirm(`Delete ${c.code}?`)) remove.mutate(c.id); }}
                      disabled={c.is_default}
                      className="text-gray-400 hover:text-red-600 p-1 disabled:opacity-30"
                    ><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-bold mb-4">{editing ? 'Edit Currency' : 'Add Currency'}</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Code *</label>
                  <input {...register('code')} placeholder="USD" className="w-full border border-gray-300 px-3 py-2 text-sm uppercase" />
                  {errors.code && <p className="text-red-500 text-xs mt-1">{errors.code.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Symbol *</label>
                  <input {...register('symbol')} placeholder="$" className="w-full border border-gray-300 px-3 py-2 text-sm" />
                  {errors.symbol && <p className="text-red-500 text-xs mt-1">{errors.symbol.message}</p>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
                <input {...register('name')} placeholder="US Dollar" className="w-full border border-gray-300 px-3 py-2 text-sm" />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Exchange Rate (units per 1 USD) *</label>
                <input {...register('exchange_rate')} type="number" step="0.000001" placeholder="1.000000" className="w-full border border-gray-300 px-3 py-2 text-sm" />
                {errors.exchange_rate && <p className="text-red-500 text-xs mt-1">{errors.exchange_rate.message}</p>}
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input {...register('is_active')} type="checkbox" /> Active
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input {...register('is_default')} type="checkbox" /> Set as default
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold disabled:opacity-60">
                  {editing ? 'Save Changes' : 'Add Currency'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
