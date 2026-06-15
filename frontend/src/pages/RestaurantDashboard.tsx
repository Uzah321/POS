import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DollarSign, ShoppingCart, TrendingUp, Clock, ChefHat, CheckCircle, Loader2 } from 'lucide-react';
import { useCurrencyStore } from '../stores/currencyStore';
import { format } from 'date-fns';

function StatCard({ label, value, sub, icon: Icon, color = 'blue' }: {
  label: string; value: string | number; sub?: string; icon: any; color?: string;
}) {
  const colors: Record<string, string> = {
    blue:   'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    green:  'bg-green-50 text-green-600',
    amber:  'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-100">
      <div className={`w-10 h-10 rounded-md flex items-center justify-center mb-4 ${colors[color]}`}>
        <Icon size={18} />
      </div>
      <p className="text-2xl font-bold text-gray-900 mb-0.5">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function KdsBadge({ label, count, color }: { label: string; count: number; color: string }) {
  const colors: Record<string, string> = {
    blue:   'bg-blue-600',
    amber:  'bg-amber-500',
    green:  'bg-green-500',
  };
  return (
    <div className="flex items-center gap-3 bg-white rounded-lg p-4 shadow-sm border border-gray-100">
      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${colors[color]}`} />
      <div>
        <p className="text-2xl font-black text-gray-900 tabular-nums">{count}</p>
        <p className="text-xs text-gray-500 font-medium">{label}</p>
      </div>
    </div>
  );
}

export default function RestaurantDashboard() {
  const { format: formatCurrency } = useCurrencyStore();
  const today = format(new Date(), 'EEEE, MMMM d');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => reportsApi.dashboard().then(r => r.data),
  });

  const { data: kdsData } = useQuery({
    queryKey: ['kds-orders'],
    queryFn: () => axios.get('/api/kds/orders').then(r => r.data),
    refetchInterval: 6000,
  });

  const d           = data?.data || {};
  const trend       = d.sales_trend || [];
  const topProducts = d.top_products || [];
  const kdsOrders   = kdsData?.data || [];

  const newOrders       = kdsOrders.filter((o: any) => o.kds_status === 'new').length;
  const preparingOrders = kdsOrders.filter((o: any) => o.kds_status === 'preparing').length;
  const readyOrders     = kdsOrders.filter((o: any) => o.kds_status === 'ready').length;
  const totalActive     = newOrders + preparingOrders + readyOrders;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Restaurant Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">{today}</p>
        </div>
        {isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-3 py-1">
            <Loader2 size={11} className="animate-spin" /> Updating...
          </span>
        )}
      </div>

      {/* KDS live status bar */}
      <div className="bg-gray-950 rounded-xl px-6 py-4 flex items-center gap-6">
        <div className="flex items-center gap-2 flex-shrink-0">
          <ChefHat size={20} className="text-orange-400" />
          <span className="text-white font-semibold text-sm">Kitchen Status</span>
          {totalActive > 0 && (
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          )}
        </div>
        <div className="flex-1 grid grid-cols-3 gap-3">
          <KdsBadge label="New Orders"  count={newOrders}       color="blue"  />
          <KdsBadge label="Preparing"   count={preparingOrders} color="amber" />
          <KdsBadge label="Ready"       count={readyOrders}     color="green" />
        </div>
        <a href="/kitchen" target="_blank" rel="noopener"
          className="text-xs text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap border border-orange-800 rounded-md px-3 py-1.5 transition-colors flex-shrink-0">
          Open Kitchen →
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Revenue Today"  value={formatCurrency(d.today?.revenue ?? 0)}       icon={DollarSign}    color="blue"   sub={`${d.today?.sales_count ?? 0} orders`} />
        <StatCard label="Orders Today"   value={d.today?.sales_count ?? 0}                   icon={ShoppingCart}  color="orange" sub="Completed" />
        <StatCard label="Avg Order"      value={formatCurrency(d.today?.sales_count > 0 ? (d.today?.revenue ?? 0) / d.today.sales_count : 0)} icon={TrendingUp} color="green" sub="Per cover" />
        <StatCard label="Active Kitchen" value={totalActive}                                  icon={Clock}         color="amber"  sub="In progress" />
      </div>

      {/* Charts + Popular dishes */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Sales trend */}
        <div className="xl:col-span-2 bg-white rounded-lg p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900 text-base">Sales Trend</h2>
            <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded-full">Last 30 days</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="orangeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f97316" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => v?.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={v => [formatCurrency(v as number), 'Revenue']}
                contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
              <Area type="monotone" dataKey="revenue" stroke="#f97316" fill="url(#orangeGrad)" strokeWidth={2.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Popular dishes */}
        <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base mb-4">Popular Dishes</h2>
          {topProducts.length > 0 ? (
            <div className="space-y-3">
              {topProducts.slice(0, 7).map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center text-xs font-bold text-orange-600 flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                    <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.min(100, (p.quantity / (topProducts[0]?.quantity || 1)) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-gray-500 flex-shrink-0">{p.quantity}x</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm flex-col gap-2">
              <ChefHat size={32} className="text-gray-200" />
              <span>No dishes sold yet</span>
            </div>
          )}
        </div>
      </div>

      {/* Active kitchen orders list */}
      <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 text-base flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${totalActive > 0 ? 'bg-orange-400 animate-pulse' : 'bg-gray-300'}`} />
            Live Kitchen Orders
          </h2>
          <a href="/kitchen" target="_blank" rel="noopener"
            className="text-xs text-orange-500 hover:text-orange-600 font-semibold">
            Open display →
          </a>
        </div>
        {kdsOrders.filter((o: any) => o.kds_status !== 'served').length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {kdsOrders.filter((o: any) => o.kds_status !== 'served').slice(0, 10).map((order: any) => {
              const colors: Record<string, string> = {
                new:       'border-blue-300 bg-blue-50',
                preparing: 'border-amber-300 bg-amber-50',
                ready:     'border-green-300 bg-green-50',
              };
              const badge: Record<string, string> = {
                new:       'bg-blue-100 text-blue-700',
                preparing: 'bg-amber-100 text-amber-700',
                ready:     'bg-green-100 text-green-700',
              };
              return (
                <div key={order.id} className={`rounded-lg border-2 p-3 ${colors[order.kds_status] ?? ''}`}>
                  <p className="font-black text-xl text-gray-900">{order.ticket}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {order.items?.map((i: any) => `${i.qty}× ${i.name}`).join(', ')}
                  </p>
                  <span className={`mt-2 inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${badge[order.kds_status] ?? ''}`}>
                    {order.kds_status}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-20 text-gray-400 text-sm gap-2">
            <CheckCircle size={18} className="text-green-400" /> All clear — no active orders
          </div>
        )}
      </div>

      {/* Month summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Month Revenue',  value: formatCurrency(d.month?.revenue ?? 0) },
          { label: 'Month Orders',   value: `${d.month?.sales_count ?? 0} orders` },
          { label: 'Month Customers', value: d.month?.customers ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg p-5 shadow-sm border border-gray-100">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="text-lg font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
