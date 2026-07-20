import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productsApi, warehousesApi, unitsApi, ingredientsApi } from '../api';
import {
  Loader2, Factory, Search, X, ChevronRight, BookOpen, TrendingUp, PackageOpen, Save,
  Printer, Copy, Image as ImageIcon, Plus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../lib/db';
import { offlineMutate } from '../lib/offlineMutation';
import { useCurrencyStore } from '../stores/currencyStore';

function generateSku(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefix = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  const digits = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${digits}`;
}

/** Resizes/compresses an image file client-side before it's stored as a base64
 * data URL — keeps the offline product cache (up to 500 products refreshed
 * every sync) from ballooning in size. */
async function fileToCompressedDataUrl(file: File, maxDim = 220, quality = 0.72): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

interface ProductionItem {
  product_id: number;
  product_name: string;
  product_sku: string;
  quantity: number;
  cost_price: number;
}

function ProductSearch({
  label,
  placeholder,
  onSelect,
}: {
  label: string;
  placeholder: string;
  onSelect: (p: any) => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCost, setNewCost] = useState('0');
  const [newPrice, setNewPrice] = useState('0');
  const [newUnitId, setNewUnitId] = useState('');

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['prod-search', q],
    queryFn: () => productsApi.list({ search: q, per_page: 8, is_active: 1 }).then(r => r.data?.data?.data ?? []),
    enabled: q.length >= 1,
    staleTime: 0,
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => unitsApi.list().then(r => r.data?.data ?? []),
    staleTime: 120000,
    enabled: creating,
  });

  const createMutation = useMutation({
    mutationFn: () => productsApi.create({
      name: newName.trim(),
      sku: generateSku(),
      cost_price: parseFloat(newCost) || 0,
      selling_price: parseFloat(newPrice) || 0,
      unit_id: newUnitId || null,
    }),
    onSuccess: (res) => {
      const created = res.data?.data ?? res.data;
      toast.success(`Product "${created.name}" created`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      onSelect(created);
      setQ('');
      setOpen(false);
      setCreating(false);
      setNewName('');
      setNewCost('0');
      setNewPrice('0');
      setNewUnitId('');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create product'),
  });

  const startCreating = () => {
    setNewName(q);
    setCreating(true);
  };

  return (
    <div className="relative">
      <label className="text-xs font-semibold text-gray-600 mb-1 block">{label}</label>
      <div className="flex items-center border border-gray-200 rounded-md bg-gray-50 px-3 py-2 gap-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          className="bg-transparent text-sm outline-none flex-1 placeholder-gray-400"
          placeholder={placeholder}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setCreating(false); }, 150)}
        />
      </div>
      {open && q.length >= 1 && !creating && (
        <ul className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
          {(results as any[]).map((p: any) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
                onMouseDown={() => { onSelect(p); setQ(''); setOpen(false); }}
              >
                <span className="font-medium text-gray-800">{p.name}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {p.unit?.abbreviation && (
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded" title={p.unit.name}>
                      {p.unit.abbreviation}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 font-mono">{p.sku}</span>
                </span>
              </button>
            </li>
          ))}
          {!isFetching && (results as any[]).length === 0 && (
            <li>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); startCreating(); }}
                className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2 font-medium"
              >
                <Plus size={14} /> Add "{q}" as a new product
              </button>
            </li>
          )}
        </ul>
      )}
      {open && creating && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded-md shadow-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500">New product</p>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            placeholder="Product name"
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 uppercase">Cost price</label>
              <input
                type="number" min="0" step="0.01" value={newCost}
                onChange={e => setNewCost(e.target.value)}
                onMouseDown={e => e.stopPropagation()}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 uppercase">Selling price</label>
              <input
                type="number" min="0" step="0.01" value={newPrice}
                onChange={e => setNewPrice(e.target.value)}
                onMouseDown={e => e.stopPropagation()}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 uppercase">Unit of measure</label>
            <select
              value={newUnitId}
              onChange={e => setNewUnitId(e.target.value)}
              onMouseDown={e => e.stopPropagation()}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="">No unit</option>
              {(units as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); createMutation.mutate(); }}
              disabled={!newName.trim() || createMutation.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create & Use
            </button>
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); setCreating(false); }}
              className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 rounded border border-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Same shape as ProductSearch, but searches/creates against the separate
 *  Ingredients entity (raw materials) instead of Products — used only for
 *  picking recipe ingredients. */
function IngredientSearch({
  label,
  placeholder,
  onSelect,
}: {
  label: string;
  placeholder: string;
  onSelect: (i: any) => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCost, setNewCost] = useState('0');
  const [newUnitId, setNewUnitId] = useState('');

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['ingredient-search', q],
    queryFn: () => ingredientsApi.list({ search: q, per_page: 8, is_active: 1 }).then(r => r.data?.data?.data ?? []),
    enabled: q.length >= 1,
    staleTime: 0,
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => unitsApi.list().then(r => r.data?.data ?? []),
    staleTime: 120000,
    enabled: creating,
  });

  const createMutation = useMutation({
    mutationFn: () => ingredientsApi.create({
      name: newName.trim(),
      cost_price: parseFloat(newCost) || 0,
      unit_id: newUnitId || null,
    }),
    onSuccess: (res) => {
      const created = res.data?.data ?? res.data;
      toast.success(`Ingredient "${created.name}" created`);
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      onSelect(created);
      setQ('');
      setOpen(false);
      setCreating(false);
      setNewName('');
      setNewCost('0');
      setNewUnitId('');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create ingredient'),
  });

  const startCreating = () => {
    setNewName(q);
    setCreating(true);
  };

  return (
    <div className="relative">
      <label className="text-xs font-semibold text-gray-600 mb-1 block">{label}</label>
      <div className="flex items-center border border-gray-200 rounded-md bg-gray-50 px-3 py-2 gap-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          className="bg-transparent text-sm outline-none flex-1 placeholder-gray-400"
          placeholder={placeholder}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setCreating(false); }, 150)}
        />
      </div>
      {open && q.length >= 1 && !creating && (
        <ul className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
          {(results as any[]).map((i: any) => (
            <li key={i.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
                onMouseDown={() => { onSelect(i); setQ(''); setOpen(false); }}
              >
                <span className="font-medium text-gray-800">{i.name}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {i.unit?.abbreviation && (
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded" title={i.unit.name}>
                      {i.unit.abbreviation}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 font-mono">{i.sku}</span>
                </span>
              </button>
            </li>
          ))}
          {!isFetching && (results as any[]).length === 0 && (
            <li>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); startCreating(); }}
                className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2 font-medium"
              >
                <Plus size={14} /> Add "{q}" as a new ingredient
              </button>
            </li>
          )}
        </ul>
      )}
      {open && creating && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded-md shadow-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500">New ingredient</p>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            placeholder="Ingredient name"
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div>
            <label className="text-[10px] text-gray-400 uppercase">Cost price</label>
            <input
              type="number" min="0" step="0.01" value={newCost}
              onChange={e => setNewCost(e.target.value)}
              onMouseDown={e => e.stopPropagation()}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 uppercase">Unit of measure</label>
            <select
              value={newUnitId}
              onChange={e => setNewUnitId(e.target.value)}
              onMouseDown={e => e.stopPropagation()}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="">No unit</option>
              {(units as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); createMutation.mutate(); }}
              disabled={!newName.trim() || createMutation.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create & Use
            </button>
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); setCreating(false); }}
              className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 rounded border border-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface RecipeRow {
  ingredient_id: number;
  name: string;
  sku: string;
  cost_price: number;
  quantity: number;
  unit_abbreviation?: string;
  unit_name?: string;
}

function RecipesPanel({ initialProductId }: { initialProductId?: number }) {
  const qc = useQueryClient();
  const { format } = useCurrencyStore();
  const [product, setProduct] = useState<any>(null);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const consumedInitialId = useRef(false);

  const { isFetching } = useQuery({
    queryKey: ['product-ingredients', product?.id],
    queryFn: async () => {
      const res = await productsApi.getIngredients(product.id);
      const list = res.data?.data ?? [];
      setRows(list.map((r: any) => ({
        ingredient_id: r.ingredient_id,
        name: r.ingredient?.name ?? '',
        sku: r.ingredient?.sku ?? '',
        cost_price: parseFloat(r.ingredient?.cost_price ?? 0),
        quantity: parseFloat(r.quantity),
        unit_abbreviation: r.ingredient?.unit?.abbreviation,
        unit_name: r.ingredient?.unit?.name,
      })));
      setDescription(res.data?.description ?? '');
      setImage(res.data?.image ?? null);
      return res.data;
    },
    enabled: !!product?.id,
  });

  // Deep-link from the Products page ("Recipe" button on a row) — load that
  // product straight into the panel instead of making the user search again.
  useEffect(() => {
    if (!initialProductId || consumedInitialId.current) return;
    consumedInitialId.current = true;
    productsApi.get(initialProductId).then(res => {
      const p = res.data?.data ?? res.data;
      if (p?.id) selectProduct(p);
    }).catch(() => { /* product may no longer exist — ignore, user can search manually */ });
  }, [initialProductId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectProduct = (p: any) => {
    setProduct(p);
    setRows([]);
    setDescription('');
    setImage(null);
    setCopyPickerOpen(false);
  };

  const addIngredient = (i: any) => {
    if (rows.some(r => r.ingredient_id === i.id)) { toast.error('Already added'); return; }
    setRows(prev => [...prev, {
      ingredient_id: i.id,
      name: i.name,
      sku: i.sku,
      cost_price: parseFloat(i.cost_price || 0),
      quantity: 1,
      unit_abbreviation: i.unit?.abbreviation,
      unit_name: i.unit?.name,
    }]);
  };

  const updateQty = (id: number, qty: string) => {
    const n = parseFloat(qty);
    setRows(prev => prev.map(r => r.ingredient_id === id ? { ...r, quantity: isNaN(n) ? 0 : n } : r));
  };

  const removeRow = (id: number) => setRows(prev => prev.filter(r => r.ingredient_id !== id));

  const copyFrom = async (src: any) => {
    if (product && src.id === product.id) { toast.error('Cannot copy a recipe from itself'); return; }
    try {
      const res = await productsApi.getIngredients(src.id);
      const list = res.data?.data ?? [];
      setRows(list.map((r: any) => ({
        ingredient_id: r.ingredient_id,
        name: r.ingredient?.name ?? '',
        sku: r.ingredient?.sku ?? '',
        cost_price: parseFloat(r.ingredient?.cost_price ?? 0),
        quantity: parseFloat(r.quantity),
        unit_abbreviation: r.ingredient?.unit?.abbreviation,
        unit_name: r.ingredient?.unit?.name,
      })));
      setDescription(res.data?.description ?? '');
      setImage(res.data?.image ?? null);
      setCopyPickerOpen(false);
      toast.success(`Copied recipe from "${src.name}" — remember to save`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to copy recipe');
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setImage(await fileToCompressedDataUrl(file));
    } catch {
      toast.error('Failed to load image');
    }
  };

  const calculatedCost = rows.reduce((s, r) => s + r.quantity * r.cost_price, 0);
  const sellingPrice = parseFloat(product?.selling_price || 0);
  const profit = sellingPrice - calculatedCost;
  const margin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ingredientsPayload = rows.map(r => ({ ingredient_id: r.ingredient_id, quantity: r.quantity }));
      const [ingredients, details] = await Promise.all([
        offlineMutate(
          () => productsApi.syncIngredients(product.id, ingredientsPayload),
          'product_ingredients', 'sync', { ingredients: ingredientsPayload }, product.id,
        ),
        offlineMutate(
          () => productsApi.update(product.id, { description, image }),
          'products', 'update', { description, image }, product.id,
        ),
      ]);
      return { ingredients, details };
    },
    onSuccess: ({ ingredients, details }) => {
      const offline = ingredients.offline || details.offline;
      toast.success(offline ? 'Recipe saved offline — will sync when server is back' : 'Recipe saved — cost price recalculated');
      const newCost = (ingredients.data as any)?.cost_price;
      if (newCost != null) setProduct((p: any) => p ? { ...p, cost_price: newCost } : p);
      qc.invalidateQueries({ queryKey: ['product-ingredients', product?.id] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || e.message || 'Failed to save recipe'),
  });

  // Inject print styles once and render the printable recipe into a portal —
  // same house pattern as BarcodeLabelsPage's window.print() flow.
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'recipe-print-style';
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #recipe-print-portal { visibility: visible !important; position: fixed !important; inset: 0 !important; padding: 10mm !important; background: white !important; z-index: 99999 !important; }
        #recipe-print-portal * { visibility: visible !important; }
      }
    `;
    if (!document.getElementById('recipe-print-style')) {
      document.head.appendChild(style);
    }
    return () => { document.getElementById('recipe-print-style')?.remove(); };
  }, []);

  const printPortal = createPortal(
    <div id="recipe-print-portal" style={{ display: 'none' }}>
      {product && (
        <div style={{ fontFamily: 'sans-serif', color: '#111' }}>
          <div style={{ display: 'flex', gap: '6mm', alignItems: 'flex-start', borderBottom: '0.5mm solid #333', paddingBottom: '4mm', marginBottom: '4mm' }}>
            {image && <img src={image} alt={product.name} style={{ width: '30mm', height: '30mm', objectFit: 'cover', border: '0.3mm solid #ccc' }} />}
            <div>
              <h1 style={{ fontSize: '16pt', margin: 0 }}>{product.name}</h1>
              <p style={{ fontSize: '9pt', color: '#666', margin: '1mm 0 0' }}>SKU: {product.sku}</p>
              {description && <p style={{ fontSize: '9pt', marginTop: '2mm', whiteSpace: 'pre-wrap' }}>{description}</p>}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
            <thead>
              <tr>
                {['Ingredient', 'Cost/unit', 'Qty used', 'Line cost'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Ingredient' ? 'left' : 'right', borderBottom: '0.3mm solid #333', padding: '1.5mm' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ingredient_id}>
                  <td style={{ padding: '1.5mm', borderBottom: '0.2mm solid #ddd' }}>{r.name} <span style={{ color: '#999' }}>({r.sku})</span></td>
                  <td style={{ padding: '1.5mm', textAlign: 'right', borderBottom: '0.2mm solid #ddd' }}>{format(r.cost_price)}</td>
                  <td style={{ padding: '1.5mm', textAlign: 'right', borderBottom: '0.2mm solid #ddd' }}>{r.quantity}{r.unit_abbreviation ? ` ${r.unit_abbreviation}` : ''}</td>
                  <td style={{ padding: '1.5mm', textAlign: 'right', borderBottom: '0.2mm solid #ddd' }}>{format(r.quantity * r.cost_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: '8mm', marginTop: '5mm', fontSize: '10pt' }}>
            <p><strong>Recipe Cost:</strong> {format(calculatedCost)}</p>
            <p><strong>Selling Price:</strong> {format(sellingPrice)}</p>
            <p><strong>GP %:</strong> {margin.toFixed(1)}%</p>
          </div>
        </div>
      )}
    </div>,
    document.body
  );

  return (
    <div className="space-y-6">
      {printPortal}

      {/* Product picker */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-700 text-sm">Product</h2>
        {product ? (
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{product.name}</p>
              <p className="text-xs text-gray-400 font-mono">{product.sku}</p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              title="Print Recipe"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              <Printer size={13} /> Print Recipe
            </button>
            <button
              type="button"
              onClick={() => setCopyPickerOpen(o => !o)}
              title="Copy Recipe From..."
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              <Copy size={13} /> Copy Recipe
            </button>
            <button type="button" onClick={() => selectProduct(null)} className="text-gray-300 hover:text-red-500">
              <X size={14} />
            </button>
          </div>
        ) : (
          <ProductSearch
            label="Search product to define ingredients for"
            placeholder="Product name, SKU or barcode..."
            onSelect={selectProduct}
          />
        )}
        {product && copyPickerOpen && (
          <ProductSearch
            label="Search the product whose recipe you want to copy from"
            placeholder="Product name, SKU or barcode..."
            onSelect={copyFrom}
          />
        )}
      </div>

      {product && (
        <>
          {/* Ingredient list */}
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-700 text-sm">Ingredients</h2>
              {isFetching && <Loader2 size={14} className="animate-spin text-gray-400" />}
            </div>

            <IngredientSearch
              label="Search & add ingredient"
              placeholder="Ingredient name or SKU..."
              onSelect={addIngredient}
            />

            {rows.length > 0 ? (
              <div className="border border-gray-100 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Ingredient</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Cost/unit</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Qty used</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">Line cost</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map(r => (
                      <tr key={r.ingredient_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-gray-800">{r.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{r.sku}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-500">
                          {format(r.cost_price)}
                          {r.unit_abbreviation && <span className="text-gray-400">/{r.unit_abbreviation}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={r.quantity}
                              onChange={e => updateQty(r.ingredient_id, e.target.value)}
                              className="w-20 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {r.unit_abbreviation && (
                              <span className="text-xs text-gray-400 font-semibold w-8 text-left" title={r.unit_name}>{r.unit_abbreviation}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-800">{format(r.quantity * r.cost_price)}</td>
                        <td className="px-2 py-2.5">
                          <button type="button" onClick={() => removeRow(r.ingredient_id)} className="text-gray-300 hover:text-red-500 transition-colors">
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-300 italic text-center py-4">No ingredients added yet</p>
            )}
          </div>

          {/* Item Description */}
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-700 text-sm">Item Description</h2>
              {description && (
                <button type="button" onClick={() => setDescription('')} className="text-xs text-gray-400 hover:text-red-500">
                  Clear
                </button>
              )}
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="Notes shown on the printed recipe..."
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Item Image */}
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-3">
            <h2 className="font-semibold text-gray-700 text-sm">Item Image</h2>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {image
                  ? <img src={image} alt={product.name} className="w-full h-full object-cover" />
                  : <ImageIcon size={28} className="text-gray-300" />}
              </div>
              <div className="flex flex-col gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-semibold px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50"
                >
                  Load Picture
                </button>
                {image && (
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    className="text-xs font-semibold px-3 py-1.5 border border-red-200 text-red-600 rounded-md hover:bg-red-50"
                  >
                    Delete Picture
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Profit summary */}
          <div className="bg-white rounded-lg border border-emerald-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 text-sm mb-3 flex items-center gap-2">
              <TrendingUp size={15} className="text-emerald-600" /> Cost &amp; Profit
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Recipe Cost</p>
                <p className="text-base font-bold text-gray-800">{format(calculatedCost)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Selling Price</p>
                <p className="text-base font-bold text-gray-800">{format(sellingPrice)}</p>
              </div>
              <div className={`rounded-lg p-3 ${profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <p className="text-xs text-gray-400">Profit / unit</p>
                <p className={`text-base font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{format(profit)}</p>
              </div>
              <div className={`rounded-lg p-3 ${profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <p className="text-xs text-gray-400">GP %</p>
                <p className={`text-base font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{margin.toFixed(1)}%</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Saving will set this product's cost price to the calculated cost above, so profit reports across the app stay accurate.
            </p>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || rows.length === 0}
              className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saveMutation.isPending
                ? <><Loader2 size={16} className="animate-spin" /> Saving...</>
                : <><BookOpen size={16} /> Save Recipe & Recalculate Cost</>
              }
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CaseBreakingPanel({ warehouseId }: { warehouseId: number | '' }) {
  const qc = useQueryClient();
  const [caseProduct, setCaseProduct] = useState<any>(null);
  const [casesToBreak, setCasesToBreak] = useState('1');
  const [setupUnit, setSetupUnit] = useState<any>(null);
  const [setupQty, setSetupQty] = useState('');

  const { data: caseUnit, isFetching } = useQuery({
    queryKey: ['product-case-unit', caseProduct?.id],
    queryFn: () => productsApi.getCaseUnit(caseProduct.id).then(r => r.data?.data ?? null),
    enabled: !!caseProduct?.id,
  });

  const selectCaseProduct = (p: any) => {
    setCaseProduct(p);
    setCasesToBreak('1');
    setSetupUnit(null);
    setSetupQty('');
  };

  // The case's "contents" is stored in its own dedicated product_case_units
  // row: the case product -> the individual unit product it unpacks into,
  // plus how many units are in one case.
  const unitDef = caseUnit
    ? { product_id: caseUnit.unit_product_id, name: caseUnit.unit_product?.name ?? '', sku: caseUnit.unit_product?.sku ?? '', unitsPerCase: parseFloat(caseUnit.units_per_case) }
    : null;

  const saveDefinitionMutation = useMutation({
    mutationFn: () => {
      if (!setupUnit) throw new Error('Select the individual product this case breaks into');
      const qty = parseFloat(setupQty);
      if (!qty || qty <= 0) throw new Error('Enter how many units are in one case');
      return productsApi.setCaseUnit(caseProduct.id, { unit_product_id: setupUnit.id, units_per_case: qty });
    },
    onSuccess: () => {
      toast.success('Case definition saved');
      qc.invalidateQueries({ queryKey: ['product-case-unit', caseProduct?.id] });
      setSetupUnit(null);
      setSetupQty('');
    },
    onError: (e: any) => toast.error(e.message || e.response?.data?.message || 'Failed to save case definition'),
  });

  const breakMutation = useMutation({
    mutationFn: async (): Promise<{ offline: boolean }> => {
      if (!warehouseId) throw new Error('Select a warehouse');
      if (!unitDef) throw new Error('Define what this case contains first');
      const cases = parseFloat(casesToBreak);
      if (!cases || cases <= 0) throw new Error('Enter how many cases to break');
      const unitsProduced = cases * unitDef.unitsPerCase;

      const payload1 = {
        warehouse_id: warehouseId,
        type: 'out',
        reason: `Case break — ${cases} case(s) of ${caseProduct.name}`,
        items: [{ product_id: caseProduct.id, quantity: cases, cost_price: parseFloat(caseProduct.cost_price || 0) }],
      };
      const payload2 = {
        warehouse_id: warehouseId,
        type: 'in',
        reason: `Case break — ${unitsProduced} × ${unitDef.name} unpacked`,
        items: [{ product_id: unitDef.product_id, quantity: unitsProduced, cost_price: unitDef.unitsPerCase > 0 ? parseFloat(caseProduct.cost_price || 0) / unitDef.unitsPerCase : 0 }],
      };

      try {
        await inventoryApi.adjust(payload1);
        await inventoryApi.adjust(payload2);
        return { offline: false };
      } catch {
        const t = Date.now();
        await db.pendingMutations.add({ id: `mut-${t}-cba`, resource: 'inventory', action: 'adjust' as any, payload: { _url: '/inventory/adjust', _method: 'POST', ...payload1 as any }, queuedAt: t, attempts: 0 });
        await db.pendingMutations.add({ id: `mut-${t + 1}-cbb`, resource: 'inventory', action: 'adjust' as any, payload: { _url: '/inventory/adjust', _method: 'POST', ...payload2 as any }, queuedAt: t + 1, attempts: 0 });
        return { offline: true };
      }
    },
    onSuccess: (result) => {
      if (result.offline) toast.success('Case break saved offline - will sync when server is back');
      else {
        toast.success('Case broken — stock updated');
        qc.invalidateQueries({ queryKey: ['inventory'] });
        qc.invalidateQueries({ queryKey: ['pos-products'] });
      }
      setCasesToBreak('1');
    },
    onError: (e: any) => toast.error(e.message || e.response?.data?.message || 'Case break failed'),
  });

  const unitsProduced = unitDef ? (parseFloat(casesToBreak) || 0) * unitDef.unitsPerCase : 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-700 text-sm">Case / Bulk Product</h2>
        {caseProduct ? (
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{caseProduct.name}</p>
              <p className="text-xs text-gray-400 font-mono">{caseProduct.sku}</p>
            </div>
            <button type="button" onClick={() => selectCaseProduct(null)} className="text-gray-300 hover:text-red-500">
              <X size={14} />
            </button>
          </div>
        ) : (
          <ProductSearch
            label="Search the case / bulk product you want to break down"
            placeholder="e.g. Coca-Cola 330ml Case of 24..."
            onSelect={selectCaseProduct}
          />
        )}
      </div>

      {caseProduct && isFetching && (
        <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
      )}

      {caseProduct && !isFetching && !unitDef && (
        <div className="bg-white rounded-lg border border-amber-200 shadow-sm p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-700 text-sm">Define what this case contains</h2>
            <p className="text-xs text-gray-400 mt-0.5">One-time setup — how many individual units are in one {caseProduct.name}?</p>
          </div>
          {setupUnit ? (
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">{setupUnit.name}</p>
                <p className="text-xs text-gray-400 font-mono">{setupUnit.sku}</p>
              </div>
              <button type="button" onClick={() => setSetupUnit(null)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
            </div>
          ) : (
            <ProductSearch
              label="Search the individual product inside the case"
              placeholder="e.g. Coca-Cola 330ml..."
              onSelect={(p) => { if (p.id === caseProduct.id) { toast.error('A case cannot contain itself'); return; } setSetupUnit(p); }}
            />
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Units per case</label>
            <input
              type="number"
              min="1"
              step="1"
              value={setupQty}
              onChange={e => setSetupQty(e.target.value)}
              placeholder="e.g. 24"
              className="border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
            />
          </div>
          <button
            type="button"
            onClick={() => saveDefinitionMutation.mutate()}
            disabled={saveDefinitionMutation.isPending || !setupUnit || !setupQty}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveDefinitionMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save Case Definition</>}
          </button>
        </div>
      )}

      {caseProduct && unitDef && (
        <div className="bg-white rounded-lg border border-emerald-100 shadow-sm p-5 space-y-4">
          <p className="text-sm text-gray-700">
            1 case of <strong>{caseProduct.name}</strong> = <strong>{unitDef.unitsPerCase}</strong> × {unitDef.name}
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Cases to break</label>
            <input
              type="number"
              min="1"
              step="1"
              value={casesToBreak}
              onChange={e => setCasesToBreak(e.target.value)}
              className="border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
            />
          </div>
          <div className="flex items-center gap-3 text-sm bg-gray-50 rounded-md p-3">
            <span className="text-gray-500">− {casesToBreak || 0} × {caseProduct.name}</span>
            <ChevronRight size={16} className="text-gray-300" />
            <span className="font-semibold text-emerald-700">+ {unitsProduced} × {unitDef.name}</span>
          </div>
          <button
            type="button"
            onClick={() => breakMutation.mutate()}
            disabled={breakMutation.isPending || !warehouseId || !casesToBreak}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {breakMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Breaking...</> : <><PackageOpen size={16} /> Break Case</>}
          </button>
        </div>
      )}
    </div>
  );
}

export default function StockProductionPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // Deep-link from the Products page's "Recipe" row button: ?tab=recipes&product=<id>
  const deepLinkProductId = searchParams.get('product');
  const [tab, setTab] = useState<'production' | 'recipes' | 'breaking'>(
    searchParams.get('tab') === 'recipes' ? 'recipes' : 'production'
  );

  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [inputs, setInputs] = useState<ProductionItem[]>([]);
  const [output, setOutput] = useState<ProductionItem | null>(null);
  const [outputQty, setOutputQty] = useState('');

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehousesApi.list().then(r => r.data?.data ?? []),
    staleTime: 60000,
  });

  // Auto-select first warehouse
  const warehouseList: any[] = warehouses as any[];
  if (warehouseList.length > 0 && warehouseId === '') {
    setWarehouseId(warehouseList[0].id);
  }

  const addInput = (p: any) => {
    if (inputs.some(i => i.product_id === p.id)) {
      toast.error('Product already in input list');
      return;
    }
    setInputs(prev => [...prev, {
      product_id: p.id,
      product_name: p.name,
      product_sku: p.sku,
      quantity: 1,
      cost_price: parseFloat(p.cost_price || 0),
    }]);
  };

  const removeInput = (id: number) => setInputs(prev => prev.filter(i => i.product_id !== id));

  const updateInputQty = (id: number, qty: string) => {
    const n = parseFloat(qty);
    if (isNaN(n) || n <= 0) return;
    setInputs(prev => prev.map(i => i.product_id === id ? { ...i, quantity: n } : i));
  };

  const setOutputProduct = (p: any) => {
    setOutput({
      product_id: p.id,
      product_name: p.name,
      product_sku: p.sku,
      quantity: 1,
      cost_price: parseFloat(p.cost_price || 0),
    });
    setOutputQty('1');
  };

  const productionMutation = useMutation({
    mutationFn: async (): Promise<{ offline: boolean }> => {
      if (!warehouseId) throw new Error('Select a warehouse');
      if (inputs.length === 0) throw new Error('Add at least one raw material input');
      if (!output) throw new Error('Select a finished product output');
      const qty = parseFloat(outputQty);
      if (!qty || qty <= 0) throw new Error('Enter output quantity');

      const payload1 = {
        warehouse_id: warehouseId,
        type: 'out',
        reason: notes || 'Production - raw materials consumed',
        items: inputs.map(i => ({ product_id: i.product_id, quantity: i.quantity, cost_price: i.cost_price })),
      };
      const payload2 = {
        warehouse_id: warehouseId,
        type: 'in',
        reason: notes || 'Production - finished goods added',
        items: [{ product_id: output.product_id, quantity: qty, cost_price: output.cost_price }],
      };

      try {
        await inventoryApi.adjust(payload1);
        await inventoryApi.adjust(payload2);
        return { offline: false };
      } catch {
        const t = Date.now();
        await db.pendingMutations.add({ id: `mut-${t}-pa`, resource: 'inventory', action: 'adjust' as any, payload: { _url: '/inventory/adjust', _method: 'POST', ...payload1 as any }, queuedAt: t, attempts: 0 });
        await db.pendingMutations.add({ id: `mut-${t + 1}-pb`, resource: 'inventory', action: 'adjust' as any, payload: { _url: '/inventory/adjust', _method: 'POST', ...payload2 as any }, queuedAt: t + 1, attempts: 0 });
        return { offline: true };
      }
    },
    onSuccess: (result) => {
      if (result.offline) toast.success('Production saved offline - will sync when server is back');
      else {
        toast.success('Production recorded - stock updated');
        qc.invalidateQueries({ queryKey: ['inventory'] });
        qc.invalidateQueries({ queryKey: ['pos-products'] });
      }
      setInputs([]);
      setOutput(null);
      setOutputQty('');
      setNotes('');
    },
    onError: (e: any) => toast.error(e.message || e.response?.data?.message || 'Production failed'),
  });

  const field = 'border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Factory size={22} className="text-blue-600" /> Stock Production
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Record a production run, define each product's ingredients and cost, or break bulk cases into individual units.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setTab('production')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'production' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Record Production
        </button>
        <button
          type="button"
          onClick={() => setTab('recipes')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'recipes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Ingredients &amp; Cost
        </button>
        <button
          type="button"
          onClick={() => setTab('breaking')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
            tab === 'breaking' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <PackageOpen size={14} /> Break Bulk / Cases
        </button>
      </div>

      {tab === 'recipes' ? <RecipesPanel initialProductId={deepLinkProductId ? Number(deepLinkProductId) : undefined} /> : tab === 'breaking' ? (
      <>
        {/* Warehouse */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-gray-700 text-sm">Warehouse</h2>
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(Number(e.target.value))}
            className={field + ' w-full'}
          >
            <option value="">Select warehouse...</option>
            {warehouseList.map((w: any) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <CaseBreakingPanel warehouseId={warehouseId} />
      </>
      ) : <>

      {/* Warehouse */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-3">
        <h2 className="font-semibold text-gray-700 text-sm">Warehouse</h2>
        <select
          value={warehouseId}
          onChange={e => setWarehouseId(Number(e.target.value))}
          className={field + ' w-full'}
        >
          <option value="">Select warehouse...</option>
          {warehouseList.map((w: any) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {/* Raw Material Inputs */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-700 text-sm">Raw Materials <span className="text-gray-400 font-normal">(consumed)</span></h2>
          <span className="text-xs text-gray-400">{inputs.length} item{inputs.length !== 1 ? 's' : ''}</span>
        </div>

        <ProductSearch
          label="Search & add raw material"
          placeholder="Product name, SKU or barcode..."
          onSelect={addInput}
        />

        {inputs.length > 0 && (
          <div className="border border-gray-100 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Product</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-28">Qty Used</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {inputs.map(item => (
                  <tr key={item.product_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-gray-800">{item.product_name}</p>
                      <p className="text-xs text-gray-400 font-mono">{item.product_sku}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={item.quantity}
                        onChange={e => updateInputQty(item.product_id, e.target.value)}
                        className="w-24 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <button type="button" onClick={() => removeInput(item.product_id)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Arrow */}
      <div className="flex justify-center text-gray-300">
        <ChevronRight size={28} className="rotate-90" />
      </div>

      {/* Finished Product Output */}
      <div className="bg-white rounded-lg border border-blue-100 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-700 text-sm">Finished Product <span className="text-gray-400 font-normal">(produced)</span></h2>

        {output ? (
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{output.product_name}</p>
              <p className="text-xs text-gray-400 font-mono">{output.product_sku}</p>
            </div>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={outputQty}
              onChange={e => setOutputQty(e.target.value)}
              placeholder="Qty"
              className="w-24 text-right border border-blue-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-500">units</span>
            <button type="button" onClick={() => { setOutput(null); setOutputQty(''); }} className="text-gray-300 hover:text-red-500">
              <X size={14} />
            </button>
          </div>
        ) : (
          <ProductSearch
            label="Search finished product"
            placeholder="Product name, SKU or barcode..."
            onSelect={setOutputProduct}
          />
        )}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
        <label className="text-xs font-semibold text-gray-600 mb-1 block">Production Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Batch number, production date, notes..."
          className={field + ' w-full resize-none'}
        />
      </div>

      {/* Summary + Submit */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 space-y-3">
        <div className="flex items-start gap-3 text-sm">
          <div className="flex-1">
            <p className="text-gray-500 font-medium">Inputs:</p>
            {inputs.length === 0
              ? <p className="text-gray-300 italic">None selected</p>
              : inputs.map(i => (
                  <p key={i.product_id} className="text-gray-700">− {i.quantity} × {i.product_name}</p>
                ))
            }
          </div>
          <div className="text-gray-300 text-2xl font-light self-center">→</div>
          <div className="flex-1">
            <p className="text-gray-500 font-medium">Output:</p>
            {!output
              ? <p className="text-gray-300 italic">None selected</p>
              : <p className="text-gray-700 font-semibold">+ {outputQty || '?'} × {output.product_name}</p>
            }
          </div>
        </div>

        <button
          type="button"
          onClick={() => productionMutation.mutate()}
          disabled={productionMutation.isPending || !warehouseId || inputs.length === 0 || !output || !outputQty}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {productionMutation.isPending
            ? <><Loader2 size={16} className="animate-spin" /> Recording...</>
            : <><Factory size={16} /> Record Production</>
          }
        </button>
      </div>
      </>}
    </div>
  );
}
