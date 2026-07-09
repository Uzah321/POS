import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { History, XCircle, CheckCircle, Clock, RefreshCw, UserCircle2 } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { salesApi, usersApi } from '../api';
import { db } from '../lib/db';
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
  const { user, hasRole } = useAuthStore();
  const isCashier = hasRole('cashier');
  const isAdmin = !isCashier;
  const { format: formatAmount } = useCurrencyStore();
  const [page, setPage] = useState(1);
  // null = current user; 0 = all cashiers; positive number = specific cashier
  const [selectedCashierId, setSelectedCashierId] = useState<number | null>(null);

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
      try {
        const res = await salesApi.list(params);
        // Cache API results into IndexedDB so future offline fallback has fresh data
        const apiSales: any[] = res.data?.data?.data ?? (Array.isArray(res.data?.data) ? res.data.data : []);
        if (apiSales.length > 0) {
          db.sales.bulkPut(apiSales.map((s: any) => ({
            id: s.id,
            reference: s.reference,
            status: s.status ?? 'completed',
            total: s.total ?? s.total_amount ?? 0,
            items: s.items ?? [],
            items_count: s.items_count ?? s.items?.length ?? 0,
            payments: s.payments ?? [],
            cashier_id: s.cashier?.id ?? s.cashier_id ?? 0,
            cashier_name: s.cashier?.name ?? '',
            branch_id: s.branch_id ?? 1,
            created_at: s.created_at,
            completed_at: s.completed_at,
          }))).catch(() => {});
        }
        return res.data?.data;
      } catch {
        // API unavailable — serve from local IndexedDB
        let allSales = await db.sales.orderBy('created_at').reverse().toArray();
        if (effectiveCashierId) allSales = allSales.filter(s => s.cashier_id === effectiveCashierId);
        allSales = allSales.filter(s => s.status === 'completed');
        const total = allSales.length;
        const from = (page - 1) * 20;
        const pageSales = allSales.slice(from, from + 20);
        return {
          data: pageSales.map(s => ({
            id: s.id,
            reference: s.reference,
            status: s.status,
            total: s.total,
            total_amount: s.total,
            created_at: s.created_at,
            items: s.items ?? [],
            items_count: s.items_count,
            cashier: s.cashier_name ? { name: s.cashier_name } : undefined,
          })),
          meta: {
            current_page: page,
            last_page: Math.ceil(total / 20) || 1,
            from: total > 0 ? from + 1 : 0,
            to: Math.min(from + 20, total),
            total,
          },
        };
      }
    },
    enabled: !!user?.id,
  });

  const sales: Sale[] = salesData?.data ?? (Array.isArray(salesData) ? salesData : []);
  const meta = salesData?.meta ?? (salesData?.last_page ? { current_page: salesData.current_page, last_page: salesData.last_page, from: salesData.from, to: salesData.to, total: salesData.total } : null);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-md bg-blue-100 flex items-center justify-center">
          <History size={20} className="text-blue-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">My Sales</h1>
          <p className="text-sm text-gray-500">
            {isCashier ? 'Current shift transactions - resets after each Shift End' : 'Your recent transactions'}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Admin cashier selector */}
      {isAdmin && (
        <div className="flex items-center gap-3 mb-5 p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
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
            className="flex-1 text-sm font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            return (
              <div
                key={sale.id}
                className="bg-white rounded-lg border border-gray-100 shadow-sm p-4"
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
                      {itemCount > 0 && ` Ã‚Â· ${itemCount} item${itemCount !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-gray-900">{formatAmount(total)}</p>
                  </div>
                </div>

                {/* Item summary */}
                {sale.items && sale.items.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">
                    {sale.items.slice(0, 4).map((item) => (
                      <div key={item.id} className="flex justify-between text-xs text-gray-500">
                        <span>{item.name ?? `Product #${item.product_id}`} × {item.quantity}</span>
                        <span>{formatAmount(item.unit_price * item.quantity)}</span>
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
    </div>
  );
}
