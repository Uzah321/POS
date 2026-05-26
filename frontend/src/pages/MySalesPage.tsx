import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { History, XCircle, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { salesApi } from '../api';
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
  if (status === 'cancelled') {
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

export default function MySalesPage() {
  const { user, hasPermission } = useAuthStore();
  const canVoid = hasPermission('void_sales');
  const { activeCurrency } = useCurrencyStore();
  const queryClient = useQueryClient();
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);

  const symbol = activeCurrency?.symbol ?? '$';
  const format_ = (v: number) =>
    `${symbol}${Number(v ?? 0).toFixed(2)}`;

  const { data, isLoading } = useQuery({
    queryKey: ['my-sales', user?.id],
    queryFn: async () => {
      const res = await salesApi.list({ cashier_id: user?.id, per_page: 50, sort_by: 'created_at', sort_dir: 'desc' });
      // Response shape: { success, data: { data: [...], total, ... } }
      return (res.data?.data?.data ?? res.data?.data ?? []) as Sale[];
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

  const sales = Array.isArray(data) ? data : [];

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <History size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Sales</h1>
          <p className="text-sm text-gray-500">Your recent transactions</p>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">
          <Clock size={24} className="animate-spin mr-2" />
          Loading...
        </div>
      ) : sales.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
          <History size={40} className="opacity-30" />
          <p className="text-sm">No sales yet. Start ringing up orders on the Register.</p>
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
