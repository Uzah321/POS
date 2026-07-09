import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productsApi, warehousesApi } from '../api';
import { Loader2, Factory, Search, X, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../lib/db';

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
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const { data: results = [] } = useQuery({
    queryKey: ['prod-search', q],
    queryFn: () => productsApi.list({ search: q, per_page: 8, is_active: 1 }).then(r => r.data?.data?.data ?? []),
    enabled: q.length >= 1,
    staleTime: 0,
  });

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
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && q.length >= 1 && (results as any[]).length > 0 && (
        <ul className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
          {(results as any[]).map((p: any) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
                onMouseDown={() => { onSelect(p); setQ(''); setOpen(false); }}
              >
                <span className="font-medium text-gray-800">{p.name}</span>
                <span className="text-xs text-gray-400 font-mono">{p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StockProductionPage() {
  const qc = useQueryClient();

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
          Record a production run — consume raw materials and add finished goods to stock.
        </p>
      </div>

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
    </div>
  );
}
