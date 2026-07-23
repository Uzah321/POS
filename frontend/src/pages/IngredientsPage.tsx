import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ingredientsApi, unitsApi, suppliersApi, warehousesApi } from '../api';
import { Plus, Search, Edit, Wheat, X, Loader2, Trash2, Store, ListOrdered, PackageX, PackagePlus } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';

const schema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  unit_id: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().positive().optional()),
  conversion_number: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(0).optional()),
  stock_unit: z.string().optional(),
  cost_price: z.coerce.number().min(0).default(0),
  is_active: z.coerce.boolean().default(true),
  initial_quantity: z.coerce.number().min(0).default(0),
});
type FormData = z.infer<typeof schema>;

const field = 'border border-gray-200 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full mt-1 bg-gray-50 focus:bg-white transition-colors';

function GeneralTab({ ingredient, onSaved }: { ingredient?: any; onSaved: (saved: any) => void }) {
  const qc = useQueryClient();
  const { data: units } = useQuery({ queryKey: ['units'], queryFn: () => unitsApi.list().then(r => r.data?.data || []) });
  const [addingUnit, setAddingUnit] = useState(false);
  const [newUnit, setNewUnit] = useState({ name: '', abbreviation: '' });

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: ingredient ? {
      ...ingredient,
      cost_price: parseFloat(ingredient.cost_price || 0),
      conversion_number: ingredient.conversion_number ?? undefined,
      initial_quantity: 0,
    } : {
      cost_price: 0,
      is_active: true,
      initial_quantity: 0,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: FormData) => ingredient ? ingredientsApi.update(ingredient.id, data) : ingredientsApi.create(data),
    onSuccess: (res) => {
      const saved = res.data?.data ?? res.data;
      toast.success(ingredient ? 'Ingredient updated' : 'Ingredient created');
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      onSaved(saved);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving ingredient'),
  });

  const createUnitMutation = useMutation({
    mutationFn: () => unitsApi.create({ name: newUnit.name.trim(), abbreviation: newUnit.abbreviation.trim() }),
    onSuccess: (res) => {
      const created = res.data?.data;
      qc.invalidateQueries({ queryKey: ['units'] });
      if (created?.id) setValue('unit_id' as any, created.id);
      setNewUnit({ name: '', abbreviation: '' });
      setAddingUnit(false);
      toast.success(`Unit "${created?.name}" created`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create unit'),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-sm font-semibold text-gray-700">Ingredient Name *</label>
          <input {...register('name')} className={field} />
          {errors.name && <p className="text-red-500 text-xs mt-1">Required</p>}
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-700">Barcode <span className="text-gray-400 font-medium">optional</span></label>
          <input {...register('barcode')} className={field} />
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-700">SKU <span className="text-gray-400 font-medium">optional</span></label>
          <input {...register('sku')} className={field} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-700">UOM <span className="text-gray-400 font-medium">optional</span></label>
            {!addingUnit && (
              <button type="button" onClick={() => setAddingUnit(true)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-0.5">
                <Plus size={12} /> New
              </button>
            )}
          </div>
          {addingUnit ? (
            <div className="flex gap-1.5 mt-1">
              <input
                autoFocus
                value={newUnit.name}
                onChange={e => setNewUnit(u => ({ ...u, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Escape') { setAddingUnit(false); setNewUnit({ name: '', abbreviation: '' }); } }}
                placeholder="Name (e.g. Gram)"
                className="border border-gray-200 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 bg-gray-50 focus:bg-white min-w-0"
              />
              <input
                value={newUnit.abbreviation}
                onChange={e => setNewUnit(u => ({ ...u, abbreviation: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newUnit.name.trim() && newUnit.abbreviation.trim()) { e.preventDefault(); createUnitMutation.mutate(); }
                  if (e.key === 'Escape') { setAddingUnit(false); setNewUnit({ name: '', abbreviation: '' }); }
                }}
                placeholder="g"
                className="border border-gray-200 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-16 bg-gray-50 focus:bg-white"
              />
              <button type="button" disabled={!newUnit.name.trim() || !newUnit.abbreviation.trim() || createUnitMutation.isPending}
                onClick={() => createUnitMutation.mutate()}
                className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex-shrink-0">
                {createUnitMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
              </button>
              <button type="button" onClick={() => { setAddingUnit(false); setNewUnit({ name: '', abbreviation: '' }); }}
                className="px-2 py-2 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          ) : (
            <select {...register('unit_id')} className={field}>
              <option value="">No unit</option>
              {(units as any[])?.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-700">Conversion Number <span className="text-gray-400 font-medium">optional</span></label>
          <input type="number" step="0.001" min="0" {...register('conversion_number')} className={field} />
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-700">Stock Unit <span className="text-gray-400 font-medium">optional</span></label>
          <input {...register('stock_unit')} placeholder="eg: pack, box" className={field} />
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-700">Cost Price <span className="text-gray-400 font-medium">optional</span></label>
          <input type="number" step="0.01" min="0" {...register('cost_price')} className={field} />
        </div>
        {!ingredient && (
          <div>
            <label className="text-sm font-semibold text-gray-700">Opening Stock (units)</label>
            <input type="number" step="1" min="0" {...register('initial_quantity')} className={field} placeholder="0" />
            <p className="text-xs text-gray-400 mt-1">Stock added to the default warehouse</p>
          </div>
        )}
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 select-none">
            <input type="checkbox" {...register('is_active')} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            Is Active
          </label>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={isSubmitting || mutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
          {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
          {ingredient ? 'Save' : 'Create Ingredient'}
        </button>
      </div>
    </form>
  );
}

function VendorsTab({ ingredientId }: { ingredientId: number }) {
  const [rows, setRows] = useState<Array<{ supplier_id: string; vendor_sku: string; vendor_cost: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  const { data: suppliers } = useQuery({ queryKey: ['suppliers-all'], queryFn: () => suppliersApi.list({ per_page: 500 }).then(r => r.data?.data?.data ?? r.data?.data ?? []) });

  useQuery({
    queryKey: ['ingredient-vendors', ingredientId],
    queryFn: async () => {
      const list = await ingredientsApi.vendors(ingredientId).then(r => r.data?.data ?? []);
      setRows(list.map((v: any) => ({ supplier_id: String(v.supplier_id), vendor_sku: v.vendor_sku ?? '', vendor_cost: v.vendor_cost != null ? String(v.vendor_cost) : '' })));
      setLoaded(true);
      return list;
    },
  });

  const mutation = useMutation({
    mutationFn: () => ingredientsApi.syncVendors(ingredientId, rows.filter(r => r.supplier_id).map(r => ({
      supplier_id: Number(r.supplier_id),
      vendor_sku: r.vendor_sku || undefined,
      vendor_cost: r.vendor_cost ? parseFloat(r.vendor_cost) : undefined,
    }))),
    onSuccess: () => toast.success('Vendors updated'),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving vendors'),
  });

  if (!loaded) return <div className="p-6 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="p-6 space-y-3">
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
          <select
            value={row.supplier_id}
            onChange={e => setRows(rs => rs.map((r, i) => i === idx ? { ...r, supplier_id: e.target.value } : r))}
            className="flex-1 text-sm border-0 bg-transparent focus:outline-none text-gray-700 font-medium"
          >
            <option value="">Select supplier...</option>
            {(suppliers as any[])?.map((s: any) => <option key={s.id} value={s.id}>{s.company_name || s.name}</option>)}
          </select>
          <input
            value={row.vendor_sku}
            onChange={e => setRows(rs => rs.map((r, i) => i === idx ? { ...r, vendor_sku: e.target.value } : r))}
            placeholder="Vendor SKU"
            className="w-32 text-sm bg-white border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="number" step="0.01" min="0"
            value={row.vendor_cost}
            onChange={e => setRows(rs => rs.map((r, i) => i === idx ? { ...r, vendor_cost: e.target.value } : r))}
            placeholder="Cost"
            className="w-24 text-sm bg-white border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button type="button" onClick={() => setRows(rs => rs.filter((_, i) => i !== idx))} className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows(rs => [...rs, { supplier_id: '', vendor_sku: '', vendor_cost: '' }])}
        className="w-full py-2 border-2 border-dashed border-gray-200 rounded-md text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
      >
        <Plus size={14} /> Add vendor
      </button>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
        Save Vendors
      </button>
    </div>
  );
}

function OrderingTab({ ingredientId }: { ingredientId: number }) {
  const [rows, setRows] = useState<Array<{ branch_id: number; branch_name: string; recommended_quantity: string; minimum_quantity: string; quantity: number }>>([]);
  const [loaded, setLoaded] = useState(false);

  useQuery({
    queryKey: ['ingredient-ordering', ingredientId],
    queryFn: async () => {
      const data = await ingredientsApi.ordering(ingredientId).then(r => r.data?.data);
      setRows((data?.rows ?? []).map((r: any) => ({
        branch_id: r.branch_id, branch_name: r.branch_name,
        recommended_quantity: String(r.recommended_quantity ?? 0),
        minimum_quantity: String(r.minimum_quantity ?? 0),
        quantity: r.quantity ?? 0,
      })));
      setLoaded(true);
      return data;
    },
  });

  const totalQuantity = rows.reduce((s, r) => s + (r.quantity || 0), 0);
  const totalRecommended = rows.reduce((s, r) => s + (parseInt(r.recommended_quantity, 10) || 0), 0);
  const totalMinimum = rows.reduce((s, r) => s + (parseInt(r.minimum_quantity, 10) || 0), 0);

  const mutation = useMutation({
    mutationFn: () => ingredientsApi.syncOrdering(ingredientId, rows.map(r => ({
      branch_id: r.branch_id,
      recommended_quantity: parseInt(r.recommended_quantity, 10) || 0,
      minimum_quantity: parseInt(r.minimum_quantity, 10) || 0,
    }))),
    onSuccess: () => toast.success('Ordering settings updated'),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving ordering settings'),
  });

  if (!loaded) return <div className="p-6 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Recommended Quantity</label>
          <div className={`${field} bg-gray-100`}>{totalRecommended}</div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Minimum Quantity</label>
          <div className={`${field} bg-gray-100`}>{totalMinimum}</div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Total Quantity</label>
          <div className={`${field} bg-gray-100`}>{totalQuantity}</div>
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
            <tr>
              <th className="text-left px-3 py-2">Store</th>
              <th className="text-left px-3 py-2">Recommended Quantity</th>
              <th className="text-left px-3 py-2">Minimum Quantity</th>
              <th className="text-left px-3 py-2">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.branch_id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium text-gray-700">{row.branch_name}</td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0"
                    value={row.recommended_quantity}
                    onChange={e => setRows(rs => rs.map((r, i) => i === idx ? { ...r, recommended_quantity: e.target.value } : r))}
                    className="w-24 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0"
                    value={row.minimum_quantity}
                    onChange={e => setRows(rs => rs.map((r, i) => i === idx ? { ...r, minimum_quantity: e.target.value } : r))}
                    className="w-24 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-3 py-2 text-gray-500">{row.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
        Save Ordering Settings
      </button>
    </div>
  );
}

function UnsavedNotice() {
  return (
    <div className="p-6 text-center text-sm text-gray-400">
      Save the ingredient's General details first — Vendors and Ordering need a saved ingredient to attach to.
    </div>
  );
}

function IngredientModal({ ingredient, onClose }: { ingredient?: any; onClose: () => void }) {
  const [tab, setTab] = useState<'general' | 'vendors' | 'ordering'>('general');
  const [savedId, setSavedId] = useState<number | null>(ingredient?.id ?? null);

  const tabs: Array<{ id: 'general' | 'vendors' | 'ordering'; label: string; icon: React.ElementType }> = [
    { id: 'general', label: 'General', icon: Wheat },
    { id: 'vendors', label: 'Vendors', icon: Store },
    { id: 'ordering', label: 'Ordering', icon: ListOrdered },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 pb-0">
          <h2 className="text-lg font-bold text-gray-900">{ingredient ? 'Edit Ingredient' : 'Create New Ingredient'}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1"><X size={18} /></button>
        </div>
        <div className="flex gap-1 px-6 pt-4 border-b border-gray-100">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
        {tab === 'general' && (
          <GeneralTab ingredient={ingredient ?? (savedId ? { id: savedId } : undefined)} onSaved={(saved) => { setSavedId(saved.id); if (!ingredient) setTab('vendors'); }} />
        )}
        {tab === 'vendors' && (savedId ? <VendorsTab ingredientId={savedId} /> : <UnsavedNotice />)}
        {tab === 'ordering' && (savedId ? <OrderingTab ingredientId={savedId} /> : <UnsavedNotice />)}
      </div>
    </div>
  );
}

/** Quick restock action for an ingredient that's running low/out — adds
 *  quantity to its stock at a chosen warehouse instead of requiring a full
 *  purchase order. */
function AddStockModal({ ingredient, onClose }: { ingredient: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehousesApi.list().then(r => r.data?.data ?? []),
    staleTime: 60000,
  });
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: { warehouse_id: number; quantity: number }) =>
      offlineMutate(() => ingredientsApi.addStock(ingredient.id, payload), 'ingredient_stocks', 'add', payload, ingredient.id),
    onSuccess: (result) => {
      toast.success(result.offline ? 'Stock saved offline — will sync when server is back' : `Added ${quantity} ${ingredient.unit?.abbreviation ?? ''} to "${ingredient.name}"`);
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      qc.invalidateQueries({ queryKey: ['ingredients-out-count'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to add stock'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId) { toast.error('Select a warehouse'); return; }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { toast.error('Enter a valid quantity'); return; }
    mutation.mutate({ warehouse_id: Number(warehouseId), quantity: qty });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <PackagePlus size={18} className="text-green-600" />
            <h2 className="text-base font-bold text-gray-900">Add Stock — {ingredient.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <p className="text-xs text-gray-400">
            Currently {ingredient.total_stock ?? 0} {ingredient.unit?.abbreviation ?? ''} on hand.
          </p>
          <div>
            <label className="text-sm font-semibold text-gray-700">Warehouse *</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={field} autoFocus>
              <option value="">Select warehouse...</option>
              {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700">Quantity to Add *</label>
            <input
              type="number" min="0.001" step="0.001"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="0"
              className={field}
            />
          </div>
          <button type="submit" disabled={mutation.isPending} className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
            Add Stock
          </button>
        </form>
      </div>
    </div>
  );
}

export default function IngredientsPage() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Pre-selects the "in"/"out" filter when arriving from the notification bell
  const [filter, setFilter] = useState(searchParams.get('filter') ?? '');
  const [modal, setModal] = useState<{ open: boolean; ingredient?: any }>({ open: false });
  const [addStockFor, setAddStockFor] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['ingredients', search, page, filter],
    queryFn: () => ingredientsApi.list({ search, page, per_page: 20, filter: filter || undefined }).then(r => r.data?.data),
    placeholderData: keepPreviousData,
  });

  // Lightweight counts for the summary chip — same per_page:1 trick ProductsPage
  // uses so this is just a total lookup, not a full list fetch.
  const { data: outStockMeta } = useQuery({
    queryKey: ['ingredients-out-count'],
    queryFn: () => ingredientsApi.list({ filter: 'out', per_page: 1 }).then(r => r.data?.data),
    staleTime: 0,
    refetchInterval: 30000,
  });
  const outOfStockTotal = outStockMeta?.meta?.total ?? outStockMeta?.total ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ingredientsApi.delete(id),
    onSuccess: () => { toast.success('Ingredient deleted'); qc.invalidateQueries({ queryKey: ['ingredients'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not delete ingredient'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => ingredientsApi.delete(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { failed, total: ids.length };
    },
    onSuccess: ({ failed, total }) => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      setSelectedIds(new Set());
      if (failed === 0) toast.success(`${total} ingredient${total !== 1 ? 's' : ''} deleted`);
      else toast.error(`${failed} of ${total} could not be deleted`);
    },
  });

  const rows: any[] = data?.data ?? [];
  const meta = data?.meta ?? (data?.last_page ? { current_page: data.current_page, last_page: data.last_page, from: data.from, to: data.to, total: data.total } : null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Wheat size={20} className="text-blue-600" /> Ingredients</h1>
          {outOfStockTotal > 0 && (
            <button
              type="button"
              onClick={() => { setFilter('out'); setPage(1); }}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-full transition-colors"
              title="Filter to out-of-stock ingredients"
            >
              <PackageX size={12} /> {outOfStockTotal} out of stock
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} selected ingredient${selectedIds.size !== 1 ? 's' : ''}?`)) {
                  bulkDeleteMutation.mutate(Array.from(selectedIds));
                }
              }}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {bulkDeleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete ({selectedIds.size})
            </button>
          )}
          <button
            type="button"
            onClick={() => setModal({ open: true })}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-semibold"
          >
            <Plus size={15} /> New
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="relative max-w-sm flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search ingredient by name"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 focus:border-blue-400 rounded-lg text-sm focus:outline-none"
            />
          </div>
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400"
          >
            <option value="">All Stock</option>
            <option value="in">In Stock</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No ingredients found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((ing: any) => selectedIds.has(ing.id))}
                    onChange={(e) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        rows.forEach((ing: any) => { if (e.target.checked) next.add(ing.id); else next.delete(ing.id); });
                        return next;
                      });
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="text-left px-4 py-2.5">Ingredient</th>
                <th className="text-left px-4 py-2.5">Active</th>
                <th className="text-left px-4 py-2.5">Cost</th>
                <th className="text-left px-4 py-2.5">Qty (uom)</th>
                <th className="text-left px-4 py-2.5">Stock Unit</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ing: any) => (
                <tr key={ing.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(ing.id)}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(ing.id); else next.delete(ing.id);
                          return next;
                        });
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{ing.name}</td>
                  <td className="px-4 py-2.5">{ing.is_active ? <span className="text-emerald-600">✓</span> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2.5 tabular-nums">${parseFloat(ing.cost_price || 0).toFixed(2)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{ing.total_stock ?? '-'} <span className="text-gray-400 text-xs">{ing.unit?.abbreviation}</span></td>
                  <td className="px-4 py-2.5 text-gray-500">{ing.stock_unit || '-'}</td>
                  <td className="px-4 py-2.5">
                    {(ing.total_stock ?? 0) > 0 ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">In Stock</span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Out of Stock</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => setAddStockFor(ing)} className="p-1.5 text-gray-400 hover:text-green-600 rounded-md hover:bg-green-50" title="Add Stock">
                        <PackagePlus size={15} />
                      </button>
                      <button type="button" onClick={() => setModal({ open: true, ingredient: ing })} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50" title="Edit">
                        <Edit size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Delete "${ing.name}"?`)) deleteMutation.mutate(ing.id); }}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {meta && <Pagination page={page} lastPage={meta.last_page ?? 1} from={meta.from} to={meta.to} total={meta.total} onPageChange={setPage} />}
      </div>

      {modal.open && <IngredientModal ingredient={modal.ingredient} onClose={() => setModal({ open: false })} />}
      {addStockFor && <AddStockModal ingredient={addStockFor} onClose={() => setAddStockFor(null)} />}
    </div>
  );
}
