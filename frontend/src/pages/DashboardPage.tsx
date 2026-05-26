import { useQuery } from '@tanstack/react-query';
import { reportsApi, salesApi } from '../api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { TrendingUp, ShoppingCart, DollarSign, Users, AlertTriangle, Clock, ArrowUpRight, Loader2 } from 'lucide-react';
import { useCurrencyStore } from '../stores/currencyStore';
import { format } from 'date-fns';

const PIE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

function StatCard({ label, value, sub, icon: Icon, trend, iconBg }: {
  label: string; value: string | number; sub?: string; icon: any; trend?: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon size={18} className="text-blue-600" />
        </div>
        {trend && (
          <span className="flex items-center gap-0.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            <ArrowUpRight size={12} /> {trend}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 mb-0.5">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => reportsApi.dashboard().then((r) => r.data),
  });

  const { data: heldData } = useQuery({
    queryKey: ['held-sales-dashboard'],
    queryFn: () => salesApi.listHeld().then(r => r.data),
    refetchInterval: 30000,
  });

  const { format: formatCurrency } = useCurrencyStore();

  const d = data?.data || {};
  const trend = d.sales_trend || [];
  const topProducts = d.top_products || [];
  const paymentBreakdown = d.payment_breakdown || [];
  const openOrders = Array.isArray(heldData?.data) ? heldData.data : [];

  const today = format(new Date(), 'EEEE, MMMM d');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">{today}</p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="text-xs text-gray-400">Total Products</p>
          <p className="text-lg font-bold text-gray-700">{d.total_products ?? 0}</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-3 py-1 w-fit">
          <Loader2 size={12} className="animate-spin" />
          Updating dashboard data...
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Sales Today"
          value={formatCurrency(d.today?.revenue ?? 0)}
          sub={`${d.today?.sales_count ?? 0} transactions`}
          icon={DollarSign}
          iconBg="bg-blue-50"
          trend="+12%"
        />
        <StatCard
          label="Orders"
          value={d.today?.sales_count ?? 0}
          sub="Today"
          icon={ShoppingCart}
          iconBg="bg-blue-50"
          trend="+8%"
        />
        <StatCard
          label="Avg Ticket"
          value={formatCurrency(
            d.today?.sales_count > 0
              ? (d.today?.revenue ?? 0) / d.today.sales_count
              : 0
          )}
          sub="Per sale"
          icon={TrendingUp}
          iconBg="bg-blue-50"
        />
        <StatCard
          label="Low Stock"
          value={d.low_stock_count ?? 0}
          sub="Items need reorder"
          icon={AlertTriangle}
          iconBg={d.low_stock_count > 0 ? 'bg-orange-50' : 'bg-blue-50'}
        />
      </div>

      {/* Charts + Top Products */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Sales area chart */}
        <div className="xl:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900 text-base">Sales Trend</h2>
            <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded-full">Last 30 days</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => v?.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                formatter={(v) => [formatCurrency(v as number), 'Revenue']}
                contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#2563eb" fill="url(#blueGrad)" strokeWidth={2.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Top selling items */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base mb-4">Top Selling Items</h2>
          {topProducts.length > 0 ? (
            <div className="space-y-3">
              {topProducts.slice(0, 6).map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-sm flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.quantity} sold</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{formatCurrency(p.revenue ?? 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm flex-col gap-2">
              <ShoppingCart size={32} className="text-gray-200" />
              <span>No sales yet</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: payment breakdown + live orders */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Payment methods */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base mb-4">Payment Methods</h2>
          {paymentBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={paymentBreakdown} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="total" nameKey="method">
                  {paymentBreakdown.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Legend formatter={(v: string) => v.replace('_', ' ')} iconSize={10} />
                <Tooltip formatter={(v) => formatCurrency(v as number)} contentStyle={{ borderRadius: '10px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No payment data</div>
          )}
        </div>

        {/* Live / open orders */}
        <div className="xl:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-base flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse inline-block" />
              Live Orders
            </h2>
            <a href="/orders" className="text-xs text-blue-600 hover:underline">View all →</a>
          </div>
          {openOrders.length > 0 ? (
            <div className="space-y-2">
              {openOrders.slice(0, 4).map((order: any) => (
                <div key={order.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Clock size={14} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{order.reference}</p>
                    <p className="text-xs text-gray-400">
                      {order.table_number ? `Table ${order.table_number} · ` : ''}
                      {order.cart_data?.items?.length ?? 0} items
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    order.order_status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                    order.order_status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {order.order_status ?? 'open'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm flex-col gap-2">
              <Clock size={32} className="text-gray-200" />
              <span>No open orders</span>
            </div>
          )}
        </div>
      </div>

      {/* Month summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <TrendingUp size={18} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400">Month Revenue</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(d.month?.revenue ?? 0)}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <ShoppingCart size={18} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400">Month Sales</p>
            <p className="text-lg font-bold text-gray-900">{d.month?.sales_count ?? 0} sales</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Users size={18} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400">Customers (Month)</p>
            <p className="text-lg font-bold text-gray-900">{d.month?.customers ?? 0}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
