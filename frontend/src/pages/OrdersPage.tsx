import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi } from '../api';
import { useCurrencyStore } from '../stores/currencyStore';
import { Clock, CheckCircle, ChefHat, ShoppingBag, RefreshCw, Loader2, Table } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';

type OrderStatus = 'open' | 'preparing' | 'ready' | 'completed';

const COLUMNS: { key: OrderStatus; label: string; icon: any; color: string; bg: string; btnLabel: string; nextStatus: OrderStatus | null }[] = [
  {
    key: 'open',
    label: 'Open',
    icon: ShoppingBag,
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200',
    btnLabel: 'Start Preparing',
    nextStatus: 'preparing',
  },
  {
    key: 'preparing',
    label: 'Preparing',
    icon: ChefHat,
    color: 'text-orange-600',
    bg: 'bg-orange-50 border-orange-200',
    btnLabel: 'Mark Ready',
    nextStatus: 'ready',
  },
  {
    key: 'ready',
    label: 'Ready',
    icon: Clock,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200',
    btnLabel: 'Complete & Serve',
    nextStatus: null, // completing moves to sales
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: CheckCircle,
    color: 'text-gray-500',
    bg: 'bg-gray-50 border-gray-200',
    btnLabel: '',
    nextStatus: null,
  },
];

const STATUS_BADGE: Record<OrderStatus, string> = {
  open: 'bg-blue-100 text-blue-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-gray-100 text-gray-600',
};

interface HeldOrder {
  id: number;
  reference: string;
  order_status: OrderStatus;
  table_number: string | null;
  created_at: string;
  cart_data: {
    items?: Array<{ name: string; quantity: number; price: number }>;
    total?: number;
  };
  customer?: { name: string } | null;
}

interface CompletedSale {
  id: number;
  reference: string;
  table_number?: string | null;
  created_at: string;
  total: number;
  items?: Array<{ name: string; quantity: number }>;
}

function OrderCard({
  order,
  column,
  onAdvance,
  onDelete,
  isAdvancing,
  format,
}: {
  order: HeldOrder;
  column: typeof COLUMNS[0];
  onAdvance?: () => void;
  onDelete?: () => void;
  isAdvancing?: boolean;
  format: (v: number) => string;
}) {
  const items = order.cart_data?.items ?? [];
  const total = order.cart_data?.total ?? 0;
  const timeAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true });

  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-gray-900 text-sm">{order.reference}</p>
          <p className="text-xs text-gray-400 mt-0.5">{timeAgo}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {order.table_number && (
            <span className="flex items-center gap-1 text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
              <Table size={10} /> {order.table_number}
            </span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[order.order_status]}`}>
            {order.order_status}
          </span>
        </div>
      </div>

      {order.customer && (
        <p className="text-xs text-gray-500">Ã°Å¸'Â¤ {order.customer.name}</p>
      )}

      <div className="space-y-1">
        {items.slice(0, 3).map((item: any, i: number) => (
          <div key={i} className="flex items-center justify-between text-xs text-gray-600">
            <span className="truncate">{item.quantity}Ãƒ" {item.name}</span>
            <span className="text-gray-400 ml-2 flex-shrink-0">{format(item.price * item.quantity)}</span>
          </div>
        ))}
        {items.length > 3 && (
          <p className="text-xs text-gray-400">+{items.length - 3} more items</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-gray-50">
        <span className="text-sm font-bold text-gray-900">{format(total)}</span>
        <div className="flex items-center gap-1.5">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
            >
              Remove
            </button>
          )}
          {onAdvance && column.btnLabel && (
            <button
              type="button"
              onClick={onAdvance}
              disabled={isAdvancing}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-60"
            >
              {isAdvancing ? <Loader2 size={11} className="animate-spin" /> : null}
              {column.btnLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CompletedCard({ sale, format }: { sale: CompletedSale; format: (v: number) => string }) {
  const timeAgo = formatDistanceToNow(new Date(sale.created_at), { addSuffix: true });
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 opacity-75">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-bold text-gray-700 text-sm">{sale.reference}</p>
          <p className="text-xs text-gray-400">{timeAgo}</p>
        </div>
        {sale.table_number && (
          <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
            {sale.table_number}
          </span>
        )}
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">Completed</span>
        <span className="text-sm font-bold text-gray-700">{format(sale.total)}</span>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [advancingId, setAdvancingId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { format: formatCurrency } = useCurrencyStore();

  const { data: heldData, isLoading, refetch } = useQuery({
    queryKey: ['held-orders'],
    queryFn: () => salesApi.listHeld().then(r => r.data?.data ?? []),
    refetchInterval: 30000,
  });

  const { data: completedData } = useQuery({
    queryKey: ['completed-sales-today'],
    queryFn: () => {
      const today = new Date().toISOString().split('T')[0];
      return salesApi.list({ date_from: today, date_to: today, per_page: 20 }).then(r => r.data?.data?.data ?? []);
    },
    refetchInterval: 30000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => offlineMutate(() => salesApi.updateHeldStatus(id, status), 'held_orders', 'update', { order_status: status }, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Order status saved offline — will sync when server is back');
      else { qc.invalidateQueries({ queryKey: ['held-orders'] }); toast.success('Order updated'); }
    },
    onSettled: () => setAdvancingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => offlineMutate(() => salesApi.deleteHeld(id), 'held_orders', 'delete', {}, id),
    onSuccess: (result) => {
      if (result.offline) toast.success('Order removed offline — will sync when server is back');
      else { qc.invalidateQueries({ queryKey: ['held-orders'] }); toast.success('Order removed'); }
    },
  });

  const orders: HeldOrder[] = Array.isArray(heldData) ? heldData : [];
  const completedSales: CompletedSale[] = Array.isArray(completedData) ? completedData : [];

  const getColumnOrders = (status: OrderStatus) =>
    orders.filter(o => (o.order_status ?? 'open') === status);

  const handleAdvance = (order: HeldOrder, nextStatus: OrderStatus | null) => {
    if (!nextStatus) return;
    setAdvancingId(order.id);
    statusMutation.mutate({ id: order.id, status: nextStatus });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {orders.length} active order{orders.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-600 bg-white border border-gray-200 hover:border-blue-300 px-4 py-2 rounded-md transition-all"
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Kanban columns */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const colOrders = getColumnOrders(col.key);
            const count = col.key === 'completed' ? completedSales.length : colOrders.length;

            return (
              <div key={col.key} className="flex flex-col gap-3">
                {/* Column header */}
                <div className={`flex items-center justify-between px-4 py-3 rounded-md border ${col.bg}`}>
                  <div className="flex items-center gap-2">
                    <col.icon size={16} className={col.color} />
                    <span className={`font-semibold text-sm ${col.color}`}>{col.label}</span>
                  </div>
                  <span className={`text-sm font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                    count > 0 ? 'bg-white shadow-sm text-gray-700' : 'text-gray-400'
                  }`}>
                    {count}
                  </span>
                </div>

                {/* Cards */}
                <div className="space-y-3 min-h-[200px]">
                  {col.key === 'completed' ? (
                    completedSales.length === 0 ? (
                      <div className="flex items-center justify-center h-24 rounded-lg border-2 border-dashed border-gray-200 text-gray-400 text-sm">
                        No completed orders today
                      </div>
                    ) : (
                      completedSales.map(sale => (
                        <CompletedCard key={sale.id} sale={sale} format={formatCurrency} />
                      ))
                    )
                  ) : colOrders.length === 0 ? (
                    <div className="flex items-center justify-center h-24 rounded-lg border-2 border-dashed border-gray-100 text-gray-300 text-sm">
                      No orders here
                    </div>
                  ) : (
                    colOrders.map(order => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        column={col}
                        format={formatCurrency}
                        isAdvancing={advancingId === order.id}
                        onAdvance={col.nextStatus ? () => handleAdvance(order, col.nextStatus) : undefined}
                        onDelete={col.key === 'open' ? () => deleteMutation.mutate(order.id) : undefined}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
