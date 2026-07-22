import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, AlertTriangle, PackageX, Wallet, Loader2, Wheat } from 'lucide-react';
import { inventoryApi, ingredientsApi } from '../../api';
import api from '../../lib/axios';
import { useAuthStore } from '../../stores/authStore';

interface StockRow {
  id: number;
  name: string;
  sku?: string;
  reorder_level?: number;
  stocks_sum_quantity?: number | null;
}

/** Bell icon in the top nav — click to see low/out-of-stock products and,
 * for managers, cash-ups still awaiting approval. */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const isManager = hasRole('admin') || hasRole('manager');

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const { data: lowStock, isLoading: loadingLow } = useQuery({
    queryKey: ['notif-low-stock'],
    queryFn: () => inventoryApi.stockLevels({ filter: 'low', per_page: 5 }).then(r => r.data?.data),
    refetchInterval: 60000,
    staleTime: 0,
  });
  const { data: outStock, isLoading: loadingOut } = useQuery({
    queryKey: ['notif-out-stock'],
    queryFn: () => inventoryApi.stockLevels({ filter: 'out', per_page: 5 }).then(r => r.data?.data),
    refetchInterval: 60000,
    staleTime: 0,
  });
  const { data: outIngredients, isLoading: loadingOutIngredients } = useQuery({
    queryKey: ['notif-out-ingredients'],
    queryFn: () => ingredientsApi.list({ filter: 'out', per_page: 5 }).then(r => r.data?.data),
    refetchInterval: 60000,
    staleTime: 0,
  });
  const { data: cashupsRaw, isLoading: loadingCashups } = useQuery({
    queryKey: ['notif-pending-cashups'],
    queryFn: () => api.get('/shift-end', { params: { per_page: 100 } }).then(r => r.data?.data),
    enabled: isManager,
    refetchInterval: 60000,
    staleTime: 0,
  });

  const lowRows: StockRow[] = lowStock?.data ?? [];
  const outRows: StockRow[] = outStock?.data ?? [];
  const lowTotal = lowStock?.meta?.total ?? lowStock?.total ?? lowRows.length;
  const outTotal = outStock?.meta?.total ?? outStock?.total ?? outRows.length;
  const outIngredientRows: StockRow[] = outIngredients?.data ?? [];
  const outIngredientTotal = outIngredients?.meta?.total ?? outIngredients?.total ?? outIngredientRows.length;
  const allCashups: any[] = Array.isArray(cashupsRaw) ? cashupsRaw : cashupsRaw?.data ?? [];
  const pendingCashups = allCashups.filter((c) => c.status === 'pending').slice(0, 5);
  const pendingTotal = allCashups.filter((c) => c.status === 'pending').length;

  const loading = loadingLow || loadingOut || loadingOutIngredients || (isManager && loadingCashups);
  const totalCount = lowTotal + outTotal + outIngredientTotal + (isManager ? pendingTotal : 0);

  const goTo = (path: string) => { setOpen(false); navigate(path); };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative text-slate-500 hover:text-blue-700 transition-colors p-1.5 rounded-md hover:bg-blue-50 border border-transparent hover:border-blue-200"
        title="Notifications"
      >
        <Bell size={19} />
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-[28rem] overflow-y-auto bg-white rounded-lg border border-gray-200 shadow-xl z-50">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            {loading && <Loader2 size={13} className="animate-spin text-gray-400" />}
          </div>

          {totalCount === 0 && !loading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">You're all caught up.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {outTotal > 0 && (
                <div className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => goTo('/inventory?filter=out')}
                    className="w-full flex items-center justify-between text-xs font-semibold text-red-600 uppercase tracking-wide mb-2 hover:underline"
                  >
                    <span className="flex items-center gap-1.5"><PackageX size={13} /> Out of Stock</span>
                    <span>{outTotal}</span>
                  </button>
                  <ul className="space-y-1.5">
                    {outRows.map((p) => (
                      <li key={p.id} className="text-sm text-gray-700 flex items-center justify-between gap-2">
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-red-500 font-medium flex-shrink-0">0 units</span>
                      </li>
                    ))}
                  </ul>
                  {outTotal > outRows.length && (
                    <button type="button" onClick={() => goTo('/inventory?filter=out')} className="text-xs text-blue-600 hover:underline mt-1.5">
                      View all {outTotal} →
                    </button>
                  )}
                </div>
              )}

              {outIngredientTotal > 0 && (
                <div className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => goTo('/ingredients?filter=out')}
                    className="w-full flex items-center justify-between text-xs font-semibold text-red-600 uppercase tracking-wide mb-2 hover:underline"
                  >
                    <span className="flex items-center gap-1.5"><Wheat size={13} /> Out of Stock Ingredients</span>
                    <span>{outIngredientTotal}</span>
                  </button>
                  <ul className="space-y-1.5">
                    {outIngredientRows.map((i) => (
                      <li key={i.id} className="text-sm text-gray-700 flex items-center justify-between gap-2">
                        <span className="truncate">{i.name}</span>
                        <span className="text-xs text-red-500 font-medium flex-shrink-0">0 units</span>
                      </li>
                    ))}
                  </ul>
                  {outIngredientTotal > outIngredientRows.length && (
                    <button type="button" onClick={() => goTo('/ingredients?filter=out')} className="text-xs text-blue-600 hover:underline mt-1.5">
                      View all {outIngredientTotal} →
                    </button>
                  )}
                </div>
              )}

              {lowTotal > 0 && (
                <div className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => goTo('/inventory?filter=low')}
                    className="w-full flex items-center justify-between text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2 hover:underline"
                  >
                    <span className="flex items-center gap-1.5"><AlertTriangle size={13} /> Low Stock</span>
                    <span>{lowTotal}</span>
                  </button>
                  <ul className="space-y-1.5">
                    {lowRows.map((p) => (
                      <li key={p.id} className="text-sm text-gray-700 flex items-center justify-between gap-2">
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-amber-600 font-medium flex-shrink-0">{p.stocks_sum_quantity ?? 0} left</span>
                      </li>
                    ))}
                  </ul>
                  {lowTotal > lowRows.length && (
                    <button type="button" onClick={() => goTo('/inventory?filter=low')} className="text-xs text-blue-600 hover:underline mt-1.5">
                      View all {lowTotal} →
                    </button>
                  )}
                </div>
              )}

              {isManager && pendingTotal > 0 && (
                <div className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => goTo('/shift-end')}
                    className="w-full flex items-center justify-between text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2 hover:underline"
                  >
                    <span className="flex items-center gap-1.5"><Wallet size={13} /> Cash-ups Awaiting Approval</span>
                    <span>{pendingTotal}</span>
                  </button>
                  <ul className="space-y-1.5">
                    {pendingCashups.map((c) => (
                      <li key={c.id} className="text-sm text-gray-700 flex items-center justify-between gap-2">
                        <span className="truncate">{c.user?.name ?? 'Cashier'}</span>
                        <span className={`text-xs font-medium flex-shrink-0 ${c.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {c.variance >= 0 ? '+' : ''}{Number(c.variance ?? 0).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {pendingTotal > pendingCashups.length && (
                    <button type="button" onClick={() => goTo('/shift-end')} className="text-xs text-blue-600 hover:underline mt-1.5">
                      View all {pendingTotal} →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
