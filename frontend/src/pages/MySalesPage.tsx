import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { History, XCircle, CheckCircle, Clock, AlertTriangle, RefreshCw, UserCircle2 } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import toast from 'react-hot-toast';
import { salesApi, usersApi } from '../api';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';

interface SaleItem {
  id: number;
  product_id: number;
  name?: string;
  quantity: number;
  unit_price: number;
}

interface Sale {
  id: number;
  reference: string;
  status: string;
  total: number;
  total_amount?: number;
  created_at: string;
  items?: SaleItem[];
  items_count?: number;
  cashier?: { name: string };
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        <CheckCircle size={11} />
        Completed
      </span>
    );
  }
  if (status === 'voided' || status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">
        <XCircle size={11} />
        Cancelled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
      <Clock size={11} />
      {status}
    </span>
  );
}

interface StaffUser {
  id: number;
  name: string;
}

export default function MySalesPage() {
  const { user, hasPermission, hasRole } = useAuthStore();
  const canVoid = hasPermission('void_sales');
  const isCashier = hasRole('cashier');
  const isAdmin = !isCashier;
  const { activeCurrency } = useCurrencyStore();
  const queryClient = useQueryClient();
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  // null = current user; 0 = all cashiers; positive number = specific cashier
  const [selectedCashierId, setSelectedCashierId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const symbol = activeCurrency?.symbol ?? '$';
  const format_ = (v: number) =>
    `${symbol}${Number(v ?? 0).toFixed(2)}`;

  // Fetch staff list for admin cashier selector
  const { data: staffList } = useQuery({
    queryKey: ['staff-list'],
    queryFn: async () => {
      const res = await usersApi.list({ per_page: 200 });
      const rows = res.data?.data?.data ?? res.data?.data ?? res.data ?? [];
      return rows as StaffUser[];
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });

  const effectiveCashierId =
    isCashier ? user?.id
    : selectedCashierId === null ? user?.id   // default: own sales
    : selectedCashierId === 0 ? undefined      // all cashiers
    : selectedCashierId;

  const { data: salesData, isLoading, refetch } = useQuery({
    queryKey: ['my-sales', effectiveCashierId ?? 'all', isCashier ? 'shift' : 'any', page],
    queryFn: async () => {
      const params: Record<string, any> = { page, per_page: 20, sort_by: 'created_at', sort_dir: 'desc' };
      if (effectiveCashierId) params.cashier_id = effectiveCashierId;
      if (isCashier) params.current_shift = 1;
      const res = await salesApi.list(params);
      return res.data?.data;
    },
    enabled: !!user?.id,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => salesApi.cancel(id),
    onSuccess: () => {
      toast.success('Order cancelled — stock has been restored');
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      setConfirmCancelId(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to cancel order';
      toast.error(msg);
      setConfirmCancelId(null);
    },
  });

  const sales: Sale[] = salesData?.data ?? (Array.isArray(salesData) ? salesData : []);
  const meta = salesData?.meta ?? (salesData?.last_page ? { current_page: salesData.current_page, last_page: salesData.last_page, from: salesData.from, to: salesData.to, total: salesData.total } : null);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <History size={20} className="text-blue-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">My Sales</h1>
          <p className="text-sm text-gray-500">
            {isCashier ? 'Current shift transactions — resets after each Shift End' : 'Your recent transactions'}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Admin cashier selector */}
      {isAdmin && (
        <div className="flex items-center gap-3 mb-5 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <UserCircle2 size={17} className="text-blue-500 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-600 flex-shrink-0">Viewing:</span>
          <select
            value={selectedCashierId ?? 'me'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'me') setSelectedCashierId(null);
              else if (v === 'all') setSelectedCashierId(0);
              else setSelectedCashierId(Number(v));
              setPage(1);
            }}
            className="flex-1 text-sm font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="me">My Sales</option>
            <option value="all">All Cashiers</option>
            {staffList && staffList.length > 0 && (
              <optgroup label="Individual Cashier">
                {staffList
                  .filter(s => s.id !== user?.id)
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">
          <Clock size={24} className="animate-spin mr-2" />
          Loading...
        </div>
      ) : sales.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
          <History size={40} className="opacity-30" />
          <p className="text-sm">
            {isCashier
              ? 'No sales this shift. Transactions will appear here after you process a sale.'
              : 'No sales yet. Start ringing up orders on the Register.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sales.map((sale) => {
            const total = Number(sale.total ?? sale.total_amount ?? 0);
            const itemCount = sale.items_count ?? sale.items?.length ?? 0;
            const canCancel = sale.status === 'completed' && canVoid;
            return (
              <div
                key={sale.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 text-sm">{sale.reference}</span>
                      <StatusBadge status={sale.status} />
                      {isAdmin && selectedCashierId !== null && sale.cashier?.name && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                          <UserCircle2 size={10} />
                          {sale.cashier.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(new Date(sale.created_at), 'dd MMM yyyy, HH:mm')}
                      {itemCount > 0 && ` · ${itemCount} item${itemCount !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-gray-900">{format_(total)}</p>
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => setConfirmCancelId(sale.id)}
                        className="mt-1 text-xs text-red-500 hover:text-red-700 hover:underline transition-colors"
                      >
                        Cancel order
                      </button>
                    )}
                  </div>
                </div>

                {/* Item summary */}
                {sale.items && sale.items.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">
                    {sale.items.slice(0, 4).map((item) => (
                      <div key={item.id} className="flex justify-between text-xs text-gray-500">
                        <span>{item.name ?? `Product #${item.product_id}`} × {item.quantity}</span>
                        <span>{format_(item.unit_price * item.quantity)}</span>
                      </div>
                    ))}
                    {sale.items.length > 4 && (
                      <p className="text-xs text-gray-400">+{sale.items.length - 4} more items</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />

      {/* Confirm Cancel Dialog */}
      {confirmCancelId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">Cancel this order?</h2>
                <p className="text-sm text-gray-500">Stock will be restored automatically.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmCancelId(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(confirmCancelId)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
