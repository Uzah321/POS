import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { productsApi, categoriesApi, brandsApi, inventoryApi, branchesApi } from '../api';
import { db, type LocalProduct } from '../lib/db';
import { useCurrencyStore } from '../stores/currencyStore';
import { Plus, Search, Edit, Package, X, Loader2, AlertTriangle, Tag, FileSpreadsheet, RefreshCw, WifiOff, Trash2, Layers } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import InventoryImportModal from '../components/inventory/InventoryImportModal';
import { useOfflineStore } from '../stores/offlineStore';
import { useAuthStore } from '../stores/authStore';

function makeMutId() {
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generateSku(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefix = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  const digits = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${digits}`;
}

function generateBarcode(): string {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const checksum = digits.reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (checksum % 10)) % 10;
  return [...digits, check].join('');
}

const schema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional(),
  selling_price: z.coerce.number().min(0),
  cost_price: z.coerce.number().min(0),
  category_id: z.preprocess((value) => value === '' || value === null ? undefined : value, z.coerce.number().positive().optional()),
  brand_id: z.preprocess((value) => value === '' || value === null ? undefined : value, z.coerce.number().positive().optional()),
  reorder_level: z.coerce.number().min(0).default(5),
  initial_quantity: z.coerce.number().min(0).default(0),
  description: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function ProductModal({ product, onClose }: { product?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [newCatName, setNewCatName]     = useState('');
  const [addingCat, setAddingCat]       = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [addingBrand, setAddingBrand]   = useState(false);
  const isOnline = useOfflineStore((s) => s.isOnline);

  const { data: cats }   = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list().then(r => r.data?.data || []) });
  const { data: brands } = useQuery({ queryKey: ['brands'],    queryFn: () => brandsApi.list().then(r => r.data?.data || []) });

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: product ? {
      ...product,
      selling_price: parseFloat(product.selling_price || 0),
      cost_price: parseFloat(product.cost_price || 0),
      reorder_level: product.reorder_level ?? 5,
      initial_quantity: 0,
    } : {
      sku: generateSku(),
      barcode: generateBarcode(),
      reorder_level: 5,
      initial_quantity: 0,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = { ...data, reorder_level: 5 } as Record<string, unknown>;
      const saveOffline = async () => {
        if (product) {
          await db.products.put({
            ...product,
            ...payload,
            selling_price: String(data.selling_price),
            cost_price: String(data.cost_price),
          } as LocalProduct);
          await db.pendingMutations.add({
            id: makeMutId(), resource: 'products', action: 'update',
            resourceId: product.id, payload, queuedAt: Date.now(), attempts: 0,
          });
        } else {
          const tempId = -(Date.now());
          await db.products.put({
            id: tempId,
            ...payload,
            name: data.name,
            sku: data.sku,
            selling_price: String(data.selling_price), cost_price: String(data.cost_price),
            is_active: 1, total_stock: data.initial_quantity ?? 0,
          } as LocalProduct);
          await db.pendingMutations.add({
            id: makeMutId(), resource: 'products', action: 'create',
            resourceId: tempId, payload, queuedAt: Date.now(), attempts: 0,
          });
        }
      };

      if (!isOnline) {
        await saveOffline();
        return { offline: true };
      }

      try {
        const r = product ? await productsApi.update(product.id, payload) : await productsApi.create(payload);
        const saved = r.data?.data ?? r.data;
        if (saved?.id) await db.products.put(saved as LocalProduct);
        return { offline: false };
      } catch (error: any) {
        if (error.response) {
          throw error;
        }
        await saveOffline();
        return { offline: true };
      }
    },
    onSuccess: (result) => {
      if (result.offline) {
        toast.success(product ? 'Product saved offline — will sync when server is back' : 'Product added offline — will sync when server is back');
      } else {
        toast.success(product ? 'Product updated' : 'Product created');
      }
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving product'),
  });

  const createCatMutation = useMutation({
    mutationFn: (name: string) => categoriesApi.create({ name }),
    onSuccess: (res) => {
      const created = res.data?.data;
      qc.invalidateQueries({ queryKey: ['categories'] });
      if (created?.id) setValue('category_id' as any, created.id);
      setNewCatName(''); setAddingCat(false);
      toast.success(`Category "${created?.name}" created`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create category'),
  });

  const createBrandMutation = useMutation({
    mutationFn: (name: string) => brandsApi.create({ name }),
    onSuccess: (res) => {
      const created = res.data?.data;
      qc.invalidateQueries({ queryKey: ['brands'] });
      if (created?.id) setValue('brand_id' as any, created.id);
      setNewBrandName(''); setAddingBrand(false);
      toast.success(`Brand "${created?.name}" created`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create brand'),
  });

  const field = 'border border-gray-200 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full mt-1 bg-gray-50 focus:bg-white transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{product ? 'Edit Item' : 'Add New Item'}</h2>
            {!isOnline && (
              <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                <WifiOff size={11} /> Offline — will sync when server reconnects
              </p>
            )}
          </div>
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
              <label className="text-sm font-semibold text-gray-700">SKU</label>
              <div className="flex items-center gap-1.5">
                <input {...register('sku')} className={field} />
                {!product && (
                  <button type="button" onClick={() => setValue('sku', generateSku())}
                    className="mt-1 p-2.5 border border-gray-200 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0" title="Regenerate SKU">
                    <RefreshCw size={14} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Barcode</label>
              <div className="flex items-center gap-1.5">
                <input {...register('barcode')} className={field} />
                {!product && (
                  <button type="button" onClick={() => setValue('barcode', generateBarcode())}
                    className="mt-1 p-2.5 border border-gray-200 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0" title="Regenerate barcode">
                    <RefreshCw size={14} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Selling Price *</label>
              <input type="number" step="0.01" {...register('selling_price')} className={field} />
              {errors.selling_price && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Cost Price</label>
              <input type="number" step="0.01" {...register('cost_price')} className={field} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-gray-700">Category</label>
                {!addingCat && (
                  <button type="button" onClick={() => setAddingCat(true)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-0.5">
                    <Plus size={12} /> New
                  </button>
                )}
              </div>
              {addingCat ? (
                <div className="flex gap-1.5 mt-1">
                  <input
                    autoFocus
                    value={newCatName}
                    onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newCatName.trim()) createCatMutation.mutate(newCatName.trim()); } if (e.key === 'Escape') { setAddingCat(false); setNewCatName(''); } }}
                    placeholder="Category name..."
                    className="border border-blue-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 bg-white"
                  />
                  <button type="button" disabled={!newCatName.trim() || createCatMutation.isPending}
                    onClick={() => { if (newCatName.trim()) createCatMutation.mutate(newCatName.trim()); }}
                    className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {createCatMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
                  </button>
                  <button type="button" onClick={() => { setAddingCat(false); setNewCatName(''); }}
                    className="px-2 py-2 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <select {...register('category_id')} className={field}>
                  <option value="">Select category...</option>
                  {(cats as any[])?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-gray-700">Brand <span className="text-gray-400 font-medium">optional</span></label>
                {!addingBrand && (
                  <button type="button" onClick={() => setAddingBrand(true)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-0.5">
                    <Plus size={12} /> New
                  </button>
                )}
              </div>
              {addingBrand ? (
                <div className="flex gap-1.5 mt-1">
                  <input
                    autoFocus
                    value={newBrandName}
                    onChange={e => setNewBrandName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newBrandName.trim()) createBrandMutation.mutate(newBrandName.trim()); } if (e.key === 'Escape') { setAddingBrand(false); setNewBrandName(''); } }}
                    placeholder="Brand name..."
                    className="border border-blue-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 bg-white"
                  />
                  <button type="button" disabled={!newBrandName.trim() || createBrandMutation.isPending}
                    onClick={() => { if (newBrandName.trim()) createBrandMutation.mutate(newBrandName.trim()); }}
                    className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {createBrandMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
                  </button>
                  <button type="button" onClick={() => { setAddingBrand(false); setNewBrandName(''); }}
                    className="px-2 py-2 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <select {...register('brand_id')} className={field}>
                  <option value="">No brand</option>
                  {(brands as any[])?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            {!product && (
              <div>
                <label className="text-sm font-semibold text-gray-700">Opening Stock (units)</label>
                <input type="number" step="1" min="0" {...register('initial_quantity')} className={field} placeholder="0" />
                <p className="text-xs text-gray-400 mt-1">Stock added to the default warehouse</p>
              </div>
            )}
            <div className="col-span-2">
              <label className="text-sm font-semibold text-gray-700">Description</label>
              <textarea {...register('description')} rows={2} className={`${field} resize-none`} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={isSubmitting || mutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
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
  const [branchId, setBranchId] = useState('');
  const [modal, setModal] = useState<{ open: boolean; product?: any }>({ open: false });
  const [showImport, setShowImport] = useState(false);
  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'brands'>('products');
  // Category management
  const [catAdd, setCatAdd] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [catEdit, setCatEdit] = useState<{ id: number; name: string } | null>(null);
  // Brand management
  const [brandAdd, setBrandAdd] = useState('');
  const [addingBrand, setAddingBrand] = useState(false);
  const [brandEdit, setBrandEdit] = useState<{ id: number; name: string } | null>(null);

  const { format: formatCurrency } = useCurrencyStore();
  const qcMain = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('admin');

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list().then(r => r.data?.data || []),
    staleTime: 120000,
    enabled: !!isAdmin, // each branch now has its own catalog — only an admin needs to switch between them
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products', search, page, branchId],
    queryFn: async () => {
      try {
        const r = await productsApi.list({ search, page, per_page: 20, ...(branchId ? { branch_id: Number(branchId) } : {}) });
        return r.data?.data;
      } catch {
        // Fall back to IndexedDB when server is unreachable (page 1, no search only)
        if (!search && page === 1) {
          const cached = await db.products.toArray();
          if (cached.length > 0) return { data: cached, meta: null };
        }
        throw new Error('Server unreachable');
      }
    },
    placeholderData: keepPreviousData,
  });

  // Accurate aggregate stats " separate lightweight queries
  const { data: categoriesAll } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list().then(r => r.data?.data || []),
    staleTime: 120000,
  });
  const { data: lowStockMeta } = useQuery({
    queryKey: ['inventory-low-count'],
    queryFn: () => inventoryApi.stockLevels({ filter: 'low', per_page: 1 }).then(r => r.data?.data),
    staleTime: 60000,
  });
  const { data: outStockMeta } = useQuery({
    queryKey: ['inventory-out-count'],
    queryFn: () => inventoryApi.stockLevels({ filter: 'out', per_page: 1 }).then(r => r.data?.data),
    staleTime: 60000,
  });

  const { data: brandsAll } = useQuery({
    queryKey: ['brands'],
    queryFn: () => brandsApi.list().then(r => r.data?.data || []),
    staleTime: 120000,
  });

  // Category CRUD mutations
  const createCatMut = useMutation({
    mutationFn: (name: string) => categoriesApi.create({ name }),
    onSuccess: () => { qcMain.invalidateQueries({ queryKey: ['categories'] }); setCatAdd(''); setAddingCat(false); toast.success('Category created'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create category'),
  });
  const updateCatMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => categoriesApi.update(id, { name }),
    onSuccess: () => { qcMain.invalidateQueries({ queryKey: ['categories'] }); setCatEdit(null); toast.success('Category updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update category'),
  });
  const deleteCatMut = useMutation({
    mutationFn: (id: number) => categoriesApi.delete(id),
    onSuccess: () => { qcMain.invalidateQueries({ queryKey: ['categories'] }); toast.success('Category deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Cannot delete — category may be in use'),
  });

  // Brand CRUD mutations
  const createBrandMut = useMutation({
    mutationFn: (name: string) => brandsApi.create({ name }),
    onSuccess: () => { qcMain.invalidateQueries({ queryKey: ['brands'] }); setBrandAdd(''); setAddingBrand(false); toast.success('Brand created'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create brand'),
  });
  const updateBrandMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => brandsApi.update(id, { name }),
    onSuccess: () => { qcMain.invalidateQueries({ queryKey: ['brands'] }); setBrandEdit(null); toast.success('Brand updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update brand'),
  });
  const deleteBrandMut = useMutation({
    mutationFn: (id: number) => brandsApi.delete(id),
    onSuccess: () => { qcMain.invalidateQueries({ queryKey: ['brands'] }); toast.success('Brand deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Cannot delete — brand may be in use'),
  });

  const products: any[] = data?.data || [];
  // Laravel's standard paginator puts total/last_page at root level, not in a nested meta key
  const meta = data?.meta ?? (data?.last_page ? {
    current_page: data.current_page,
    last_page: data.last_page,
    from: data.from,
    to: data.to,
    total: data.total,
  } : null);

  // Summary stats " use server-side totals for accuracy across all pages
  const totalItems = meta?.total ?? products.length;
  const totalCategories = (categoriesAll as any[])?.length ?? new Set(products.map((p: any) => p.category?.name).filter(Boolean)).size;
  const lowStock = lowStockMeta?.meta?.total ?? lowStockMeta?.total ?? products.filter((p: any) => (p.total_stock ?? 0) > 0 && (p.total_stock ?? 0) <= (p.reorder_level ?? 5)).length;
  const outOfStock = outStockMeta?.meta?.total ?? outStockMeta?.total ?? products.filter((p: any) => (p.total_stock ?? 0) <= 0).length;

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
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {activeTab === 'products' ? 'Manage your product catalog and inventory'
              : activeTab === 'categories' ? 'Organise products into categories'
              : 'Manage your product brands'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'products' && (
            <>
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="flex items-center gap-2 border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 font-semibold px-4 py-2.5 rounded-md text-sm transition-colors"
              >
                <FileSpreadsheet size={16} /> Import Excel
              </button>
              <button
                type="button"
                onClick={() => setModal({ open: true })}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm shadow-md shadow-blue-100 transition-colors"
              >
                <Plus size={16} /> Add Item
              </button>
            </>
          )}
          {activeTab === 'categories' && (
            <button
              type="button"
              onClick={() => { setAddingCat(true); setCatEdit(null); }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm shadow-md shadow-blue-100 transition-colors"
            >
              <Plus size={16} /> Add Category
            </button>
          )}
          {activeTab === 'brands' && (
            <button
              type="button"
              onClick={() => { setAddingBrand(true); setBrandEdit(null); }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm shadow-md shadow-blue-100 transition-colors"
            >
              <Plus size={16} /> Add Brand
            </button>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {([
          { id: 'products',   label: 'Products',   icon: Package },
          { id: 'categories', label: 'Categories', icon: Tag },
          { id: 'brands',     label: 'Brands',     icon: Layers },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Products tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'products' && <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total Items', value: totalItems, icon: Package, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Categories', value: totalCategories, icon: Tag, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          { label: 'Low Stock', value: lowStock, icon: AlertTriangle, iconBg: lowStock > 0 ? 'bg-orange-50' : 'bg-blue-50', iconColor: lowStock > 0 ? 'text-orange-600' : 'text-blue-600' },
          { label: 'Out of Stock', value: outOfStock, icon: AlertTriangle, iconBg: outOfStock > 0 ? 'bg-red-50' : 'bg-blue-50', iconColor: outOfStock > 0 ? 'text-red-600' : 'text-blue-600' },
        ].map(({ label, value, icon: Icon, iconBg, iconColor }) => (
          <div key={label} className="bg-white rounded-lg p-5 shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-md flex items-center justify-center ${iconBg}`}>
              <Icon size={18} className={iconColor} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {isError && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0" />
          Unable to reach the server. Showing cached products where available.
        </div>
      )}

      {/* Products table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3 flex-wrap flex-1">
            <div className="relative max-w-xs flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search items..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-md text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
            </div>
            {isAdmin && (branchData as any[] || []).length > 1 && (
              <select
                value={branchId}
                onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-md px-3 py-2.5 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                <option value="">All Branches</option>
                {(branchData as any[]).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
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
                          <div className="w-9 h-9 rounded-md bg-blue-50 flex items-center justify-center text-lg flex-shrink-0">
                            <Package size={16} className="text-blue-400" />
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
                        ) : <span className="text-gray-300">"</span>}
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
                        <button
                          type="button"
                          onClick={() => setModal({ open: true, product: p })}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Edit size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>

      </>} {/* end products tab */}

      {/* ── Categories tab ───────────────────────────────────────────────────── */}
      {activeTab === 'categories' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          {addingCat && (
            <div className="flex items-center gap-2 p-4 border-b border-blue-100 bg-blue-50">
              <input
                autoFocus
                value={catAdd}
                onChange={e => setCatAdd(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && catAdd.trim()) createCatMut.mutate(catAdd.trim());
                  if (e.key === 'Escape') { setAddingCat(false); setCatAdd(''); }
                }}
                placeholder="Category name..."
                className="flex-1 border border-blue-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <button
                type="button"
                disabled={!catAdd.trim() || createCatMut.isPending}
                onClick={() => createCatMut.mutate(catAdd.trim())}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {createCatMut.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
              </button>
              <button type="button" onClick={() => { setAddingCat(false); setCatAdd(''); }} className="p-2 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">
                <X size={14} />
              </button>
            </div>
          )}
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category Name</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!(categoriesAll as any[])?.length ? (
                <tr>
                  <td colSpan={2} className="text-center py-16 text-gray-400">
                    <Tag size={36} className="mx-auto mb-3 text-gray-200" />
                    <p className="font-medium">No categories yet</p>
                    <p className="text-sm mt-1">Click "Add Category" to create your first one</p>
                  </td>
                </tr>
              ) : (categoriesAll as any[]).map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5">
                    {catEdit?.id === c.id ? (
                      <input
                        autoFocus
                        value={catEdit!.name}
                        onChange={e => setCatEdit({ ...catEdit!, name: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && catEdit!.name.trim()) updateCatMut.mutate({ id: c.id, name: catEdit!.name.trim() });
                          if (e.key === 'Escape') setCatEdit(null);
                        }}
                        className="border border-blue-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-xs"
                      />
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-md bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <Tag size={13} className="text-blue-500" />
                        </span>
                        <span className="text-sm font-medium text-gray-900">{c.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {catEdit?.id === c.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={!catEdit!.name.trim() || updateCatMut.isPending}
                          onClick={() => updateCatMut.mutate({ id: c.id, name: catEdit!.name.trim() })}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          {updateCatMut.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                        </button>
                        <button type="button" onClick={() => setCatEdit(null)} className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setCatEdit({ id: c.id, name: c.name }); setAddingCat(false); }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { if (window.confirm(`Delete category "${c.name}"? Products in this category will be unassigned.`)) deleteCatMut.mutate(c.id); }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Brands tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'brands' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          {addingBrand && (
            <div className="flex items-center gap-2 p-4 border-b border-blue-100 bg-blue-50">
              <input
                autoFocus
                value={brandAdd}
                onChange={e => setBrandAdd(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && brandAdd.trim()) createBrandMut.mutate(brandAdd.trim());
                  if (e.key === 'Escape') { setAddingBrand(false); setBrandAdd(''); }
                }}
                placeholder="Brand name..."
                className="flex-1 border border-blue-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <button
                type="button"
                disabled={!brandAdd.trim() || createBrandMut.isPending}
                onClick={() => createBrandMut.mutate(brandAdd.trim())}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {createBrandMut.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
              </button>
              <button type="button" onClick={() => { setAddingBrand(false); setBrandAdd(''); }} className="p-2 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">
                <X size={14} />
              </button>
            </div>
          )}
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Brand Name</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!(brandsAll as any[])?.length ? (
                <tr>
                  <td colSpan={2} className="text-center py-16 text-gray-400">
                    <Layers size={36} className="mx-auto mb-3 text-gray-200" />
                    <p className="font-medium">No brands yet</p>
                    <p className="text-sm mt-1">Click "Add Brand" to create your first one</p>
                  </td>
                </tr>
              ) : (brandsAll as any[]).map((b: any) => (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5">
                    {brandEdit?.id === b.id ? (
                      <input
                        autoFocus
                        value={brandEdit!.name}
                        onChange={e => setBrandEdit({ ...brandEdit!, name: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && brandEdit!.name.trim()) updateBrandMut.mutate({ id: b.id, name: brandEdit!.name.trim() });
                          if (e.key === 'Escape') setBrandEdit(null);
                        }}
                        className="border border-blue-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-xs"
                      />
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-md bg-purple-50 flex items-center justify-center flex-shrink-0">
                          <Layers size={13} className="text-purple-500" />
                        </span>
                        <span className="text-sm font-medium text-gray-900">{b.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {brandEdit?.id === b.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={!brandEdit!.name.trim() || updateBrandMut.isPending}
                          onClick={() => updateBrandMut.mutate({ id: b.id, name: brandEdit!.name.trim() })}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          {updateBrandMut.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                        </button>
                        <button type="button" onClick={() => setBrandEdit(null)} className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setBrandEdit({ id: b.id, name: b.name }); setAddingBrand(false); }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { if (window.confirm(`Delete brand "${b.name}"? Products with this brand will be unassigned.`)) deleteBrandMut.mutate(b.id); }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && <ProductModal product={modal.product} onClose={() => setModal({ open: false })} />}
      {showImport && <InventoryImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
