import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, categoriesApi, brandsApi } from '../api';
import { useCurrencyStore } from '../stores/currencyStore';
import { Plus, Search, Edit, Trash2, Package, X, Loader2, AlertTriangle, Tag, FileSpreadsheet } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import InventoryImportModal from '../components/inventory/InventoryImportModal';

const CATEGORY_EMOJI: Record<string, string> = {
  'Spirits': '🥃', 'Wine': '🍷', 'Beer & Cider': '🍺', 'Mixers & Soft Drinks': '🥤',
  'Water': '💧', 'RTD (Ready to Drink)': '🍹', 'Non-Alcoholic': '🫧',
  'Tobacco': '🚬', 'Accessories': '🔧', 'Snacks & Food': '🍫',
};

const schema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional(),
  selling_price: z.coerce.number().min(0),
  cost_price: z.coerce.number().min(0),
  category_id: z.coerce.number().optional(),
  brand_id: z.coerce.number().optional(),
  reorder_level: z.coerce.number().min(0).default(5),
  description: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function ProductModal({ product, onClose }: { product?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list().then(r => r.data?.data || []) });
  const { data: brands } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list().then(r => r.data?.data || []) });

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: product ? {
      ...product,
      selling_price: parseFloat(product.selling_price || 0),
      cost_price: parseFloat(product.cost_price || 0),
      reorder_level: product.reorder_level ?? 5,
    } : {},
  });

  const mutation = useMutation({
    mutationFn: (data: FormData) => product ? productsApi.update(product.id, data) : productsApi.create(data),
    onSuccess: () => {
      toast.success(product ? 'Product updated' : 'Product created');
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving product'),
  });

  const field = 'border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full mt-1 bg-gray-50 focus:bg-white transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{product ? 'Edit Item' : 'Add New Item'}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-sm font-semibold text-gray-700">Product Name *</label>
              <input {...register('name')} className={field} />
              {errors.name && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">SKU *</label>
              <input {...register('sku')} className={field} />
              {errors.sku && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Barcode</label>
              <input {...register('barcode')} className={field} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Selling Price (USD) *</label>
              <input type="number" step="0.01" {...register('selling_price')} className={field} />
              {errors.selling_price && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Cost Price (USD)</label>
              <input type="number" step="0.01" {...register('cost_price')} className={field} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Category</label>
              <select {...register('category_id')} className={field}>
                <option value="">Select category...</option>
                {(cats as any[])?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Brand</label>
              <select {...register('brand_id')} className={field}>
                <option value="">Select brand...</option>
                {(brands as any[])?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Reorder Point</label>
              <input type="number" {...register('reorder_level')} className={field} />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-semibold text-gray-700">Description</label>
              <textarea {...register('description')} rows={2} className={`${field} resize-none`} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={isSubmitting || mutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
              {product ? 'Update Item' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; product?: any }>({ open: false });
  const [showImport, setShowImport] = useState(false);
  const qc = useQueryClient();
  const { format: formatCurrency } = useCurrencyStore();

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, page],
    queryFn: () => productsApi.list({ search, page, per_page: 20 }).then(r => r.data?.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => productsApi.delete(id),
    onSuccess: () => { toast.success('Product deleted'); qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: () => toast.error('Failed to delete'),
  });

  const products: any[] = data?.data || [];
  const meta = data?.meta;

  // Summary stats
  const totalItems = meta?.total ?? products.length;
  const categories = new Set(products.map((p: any) => p.category?.name).filter(Boolean));
  const lowStock = products.filter((p: any) => (p.total_stock ?? 0) > 0 && (p.total_stock ?? 0) <= (p.reorder_level ?? 5)).length;
  const outOfStock = products.filter((p: any) => (p.total_stock ?? 0) <= 0).length;

  const getStockStatus = (p: any) => {
    const s = p.total_stock ?? 0;
    if (s <= 0) return { label: 'Out of Stock', cls: 'bg-red-100 text-red-700' };
    if (s <= (p.reorder_level ?? 5)) return { label: 'Low Stock', cls: 'bg-orange-100 text-orange-700' };
    return { label: 'In Stock', cls: 'bg-emerald-100 text-emerald-700' };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu & Stock</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage your product catalog and inventory</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors"
          >
            <FileSpreadsheet size={16} /> Import Excel
          </button>
          <button
            type="button"
            onClick={() => setModal({ open: true })}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm shadow-md shadow-blue-100 transition-colors"
          >
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total Items', value: totalItems, icon: Package, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Categories', value: categories.size, icon: Tag, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Low Stock', value: lowStock, icon: AlertTriangle, iconBg: lowStock > 0 ? 'bg-orange-50' : 'bg-blue-50', iconColor: lowStock > 0 ? 'text-orange-600' : 'text-blue-600' },
          { label: 'Out of Stock', value: outOfStock, icon: AlertTriangle, iconBg: outOfStock > 0 ? 'bg-red-50' : 'bg-blue-50', iconColor: outOfStock > 0 ? 'text-red-600' : 'text-blue-600' },
        ].map(({ label, value, icon: Icon, iconBg, iconColor }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
              <Icon size={18} className={iconColor} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Products table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="relative max-w-xs flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search items..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-blue-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  {['Item', 'SKU', 'Category', 'Price', 'Stock', 'Status', ''].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-gray-400">
                      <Package size={40} className="mx-auto mb-3 text-gray-200" />
                      <p className="font-medium">No products found</p>
                      <p className="text-sm mt-1">Add your first item to get started</p>
                    </td>
                  </tr>
                ) : products.map((p: any) => {
                  const status = getStockStatus(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-lg flex-shrink-0">
                            {CATEGORY_EMOJI[p.category?.name ?? ''] ?? '📦'}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                            {p.barcode && <p className="text-xs text-gray-400">{p.barcode}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">{p.sku}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {p.category?.name ? (
                          <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                            {p.category.name}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm font-bold text-gray-900">{formatCurrency(parseFloat(p.selling_price || 0))}</span>
                        <p className="text-xs text-gray-400">Cost: {formatCurrency(parseFloat(p.cost_price || 0))}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm font-bold text-gray-700">{p.total_stock ?? 0}</span>
                        <p className="text-xs text-gray-400">units</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.cls}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setModal({ open: true, product: p })}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => { if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id); }}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.last_page > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
            <p className="text-sm text-gray-500">Showing {meta.from}–{meta.to} of {meta.total} items</p>
            <div className="flex gap-2">
              <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors">Prev</button>
              <button type="button" disabled={page === meta.last_page} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      {modal.open && <ProductModal product={modal.product} onClose={() => setModal({ open: false })} />}
      {showImport && <InventoryImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
