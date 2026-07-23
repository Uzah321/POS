import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productsApi, warehousesApi } from '../api';
import { Search, AlertTriangle, Loader2, Plus, X, PackagePlus, FileSpreadsheet, ChefHat } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';
import InventoryImportModal from '../components/inventory/InventoryImportModal';

export default function InventoryPage() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Pre-selects the "low"/"out" filter when arriving from the notification bell
  const [filter, setFilter] = useState(searchParams.get('filter') ?? '');
  const [showImport, setShowImport] = useState(false);

  // Add Stock modal state
  const [showAddStock, setShowAddStock] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [addQty, setAddQty] = useState('');
  const [addCost, setAddCost] = useState('');
  const [addReason, setAddReason] = useState('');
  const productSearchRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', search, page, filter],
    queryFn: () => inventoryApi.stockLevels({ search, page, per_page: 30, filter }).then(r => r.data?.data),
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehousesApi.list().then(r => r.data?.data ?? []),
    staleTime: 60000,
  });
  const defaultWarehouseId: number = (warehousesData as any[])?.[0]?.id ?? 1;

  const { data: productOptions = [] } = useQuery({
    queryKey: ['products-for-stock', productSearch],
    queryFn: () => productsApi.list({ search: productSearch, per_page: 10, is_active: 1 }).then(r => r.data?.data?.data ?? []),
    enabled: productSearch.length >= 1 && !selectedProduct,
    staleTime: 0,
  });

  const addStockMutation = useMutation({
    mutationFn: (payload: object) => offlineMutate(() => inventoryApi.adjust(payload), 'inventory', 'adjust', payload as Record<string, unknown>),
    onSuccess: (result) => {
      if (result.offline) toast.success('Stock saved offline - will sync when server is back');
      else {
        toast.success('Stock added successfully!');
        qc.invalidateQueries({ queryKey: ['inventory'] });
        qc.invalidateQueries({ queryKey: ['inventory-low-count'] });
        qc.invalidateQueries({ queryKey: ['inventory-out-count'] });
        qc.invalidateQueries({ queryKey: ['pos-products'] });
        qc.invalidateQueries({ queryKey: ['products'] });
      }
      setShowAddStock(false);
      resetAddForm();
    },
  });

  const resetAddForm = () => {
    setSelectedProduct(null);
    setProductSearch('');
    setAddQty('');
    setAddCost('');
    setAddReason('');
  };

  const handleSubmitAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) { toast.error('Please select a product'); return; }
    if (!addQty || parseFloat(addQty) <= 0) { toast.error('Please enter a valid quantity'); return; }
    addStockMutation.mutate({
      warehouse_id: defaultWarehouseId,
      type: 'in',
      reason: addReason || 'Manual stock addition',
      items: [{
        product_id: selectedProduct.id,
        quantity: parseFloat(addQty),
        cost_price: addCost ? parseFloat(addCost) : undefined,
      }],
    });
  };

  const stocks = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-500 text-sm">Monitor stock levels across all warehouses</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm transition-colors shadow-sm">
            <FileSpreadsheet size={16} /> Import Excel
          </button>
          <button
            type="button"
            onClick={() => { setShowAddStock(true); setTimeout(() => productSearchRef.current?.focus(), 80); }}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm transition-colors shadow-sm"
          >
            <Plus size={16} /> Add Stock
          </button>
        </div>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search products..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Product', 'SKU', 'Category', 'Warehouse', 'Qty on Hand', 'Reorder Point', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stocks.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-gray-400">No products found</td></tr>
                ) : stocks.map((s: any, i: number) => {
                  // A made-to-order product (e.g. a pizza) never carries real `stocks`
                  // rows, so the raw stocks_sum_quantity aggregate is always 0 for it —
                  // use the total_stock accessor instead, which derives "how many more
                  // can be made" from the recipe's ingredient levels.
                  const qty = s.made_to_order ? (s.total_stock ?? 0) : (s.stocks_sum_quantity ?? s.quantity ?? 0);
                  const reorder = s.reorder_level ?? s.reorder_point ?? 5;
                  // Untracked items (services) carry no meaningful quantity — match
                  // InventoryController::stockLevels / ProductsPage, which both
                  // exclude track_stock === false from low/out counts, so the same
                  // product doesn't show "Out of Stock" here while reading
                  // "Not Tracked" everywhere else.
                  const tracked = s.track_stock !== false;
                  const isLow = tracked && qty > 0 && qty <= reorder;
                  const isOut = tracked && qty <= 0;
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {(isLow || isOut) && <AlertTriangle size={14} className={isOut ? 'text-red-500' : 'text-yellow-500'} />}
                          <span className="text-sm font-medium text-gray-900">{s.name}</span>
                          {s.made_to_order && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700" title="Assembled from its recipe when sold — see Stock Production → Recipes">
                              <ChefHat size={10} /> Made on Order
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{s.sku || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.category?.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.stocks?.[0]?.warehouse?.name || 'Main'}</td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900">{qty}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{reorder}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${!tracked ? 'bg-gray-100 text-gray-500' : isOut ? 'bg-red-100 text-red-700' : isLow ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                          {!tracked ? 'Not Tracked' : isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock'}
                        </span>
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
      {/* Add Stock Modal */}
      {showImport && <InventoryImportModal onClose={() => setShowImport(false)} />}

      {showAddStock && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) { setShowAddStock(false); resetAddForm(); } }}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <PackagePlus size={20} className="text-green-600" />
                <h2 className="text-lg font-bold text-gray-900">Add Stock</h2>
              </div>
              <button type="button" onClick={() => { setShowAddStock(false); resetAddForm(); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmitAddStock} className="p-5 space-y-4">
              {/* Product search */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Product *</label>
                {selectedProduct ? (
                  <div className="flex items-center justify-between px-3 py-2.5 border border-green-300 bg-green-50 rounded-md">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{selectedProduct.name}</p>
                      <p className="text-xs text-gray-500">{selectedProduct.sku}{selectedProduct.category?.name ? ` Ã‚Â· ${selectedProduct.category.name}` : ''}</p>
                    </div>
                    <button type="button" onClick={() => { setSelectedProduct(null); setProductSearch(''); }} className="text-gray-400 hover:text-red-500 transition-colors ml-2">
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      ref={productSearchRef}
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Search by name or SKU..."
                      className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    {(productOptions as any[]).length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-md shadow-xl z-10 mt-1 overflow-hidden max-h-48 overflow-y-auto">
                        {(productOptions as any[]).map((p: any) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => { setSelectedProduct(p); setProductSearch(''); if (!addCost && p.cost_price) setAddCost(String(p.cost_price)); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-green-50 text-sm border-b border-gray-50 last:border-0 transition-colors"
                          >
                            <p className="font-medium text-gray-900">{p.name}</p>
                            <p className="text-xs text-gray-400">{p.sku}{p.category?.name ? ` Ã‚Â· ${p.category.name}` : ''}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Quantity to Add *</label>
                  <input
                    type="number"
                    value={addQty}
                    onChange={(e) => setAddQty(e.target.value)}
                    min="1"
                    step="1"
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Cost Price (optional)</label>
                  <input
                    type="number"
                    value={addCost}
                    onChange={(e) => setAddCost(e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Reason (optional)</label>
                <input
                  type="text"
                  value={addReason}
                  onChange={(e) => setAddReason(e.target.value)}
                  placeholder="e.g. New delivery, Opening stock..."
                  className="w-full border border-gray-200 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowAddStock(false); resetAddForm(); }}
                  className="flex-1 border border-gray-200 text-gray-700 font-semibold py-2.5 rounded-md text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedProduct || !addQty || addStockMutation.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-md text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addStockMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  Add Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
