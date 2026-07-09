import { useQuery } from '@tanstack/react-query';
import { reportsApi, salesApi } from '../api';
import { db } from '../lib/db';
import { useAuthStore } from '../stores/authStore';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { DollarSign, ShoppingCart, TrendingUp, AlertTriangle, Users, Package, ArrowUpRight, Loader2 } from 'lucide-react';
import { useCurrencyStore } from '../stores/currencyStore';
import { format } from 'date-fns';

const PIE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

function StatCard({ label, value, sub, icon: Icon, iconBg, trend }: {
  label: string; value: string | number; sub?: string; icon: any; iconBg: string; trend?: string;
}) {
  return (
    <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-md flex items-center justify-center ${iconBg}`}>
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

export default function SupermarketDashboard() {
  const { format: formatCurrency, activeCurrency } = useCurrencyStore();
  const { user } = useAuthStore();
  const currencySymbol = activeCurrency?.symbol ?? 'R';
  const today = format(new Date(), 'EEEE, MMMM d');
  const branchId = user?.branch?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'supermarket', branchId],
    queryFn: async () => {
      try {
        return await reportsApi.dashboard().then(r => r.data);
      } catch {
        // Build dashboard stats from local IndexedDB sales (filtered to this branch)
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayStr = todayStart.toISOString();

        const allSales = await db.sales.filter(s =>
          s.status === 'completed' && (!branchId || s.branch_id === branchId)
        ).toArray();
        const todaySales = allSales.filter(s => s.created_at >= todayStr);

        const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);

        const salesTrend = Array.from({ length: 30 }, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (29 - i));
          d.setHours(0, 0, 0, 0);
          const next = new Date(d);
          next.setDate(next.getDate() + 1);
          const dStr = d.toISOString();
          const nStr = next.toISOString();
          const daySales = allSales.filter(s => s.created_at >= dStr && s.created_at < nStr);
          return {
            date: d.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' }),
            revenue: daySales.reduce((sum, s) => sum + s.total, 0),
          };
        });

        const allPayments = allSales.flatMap(s => s.payments ?? []);
        const paymentBreakdown = [
          { method: 'Cash', total: allPayments.filter(p => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0) },
          { method: 'Card', total: allPayments.filter(p => p.method === 'card').reduce((sum, p) => sum + p.amount, 0) },
          { method: 'Mobile Money', total: allPayments.filter(p => p.method === 'mobile_money').reduce((sum, p) => sum + p.amount, 0) },
        ].filter(p => p.total > 0);

        const totalProducts = await db.products.count();

        return {
          data: {
            today: { revenue: todayRevenue, sales_count: todaySales.length },
            total_products: totalProducts,
            low_stock_count: 0,
            sales_trend: salesTrend,
            top_products: [],
            payment_breakdown: paymentBreakdown,
          },
        };
      }
    },
  });

  const { data: heldData } = useQuery({
    queryKey: ['held-sales-dashboard'],
    queryFn: async () => {
      try { return await salesApi.listHeld().then(r => r.data); } catch { return { data: [] }; }
    },
    refetchInterval: 30000,
  });

  const d                = data?.data || {};
  const trend            = Array.isArray(d.sales_trend)       ? d.sales_trend       : [];
  const topProducts      = Array.isArray(d.top_products)      ? d.top_products      : [];
  const paymentBreakdown = Array.isArray(d.payment_breakdown) ? d.payment_breakdown : [];
  const openOrders       = Array.isArray(heldData?.data)      ? heldData.data       : [];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Supermarket Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-3 py-1">
              <Loader2 size={11} className="animate-spin" /> Updating...
            </span>
          )}
          <div className="text-right hidden sm:block">
            <p className="text-xs text-gray-400">Total SKUs</p>
            <p className="text-lg font-bold text-gray-700">{d.total_products ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Sales Today"  value={formatCurrency(d.today?.revenue ?? 0)}   sub={`${d.today?.sales_count ?? 0} transactions`} icon={DollarSign}    iconBg="bg-blue-50"   trend="+12%" />
        <StatCard label="Transactions" value={d.today?.sales_count ?? 0}               sub="Today"               icon={ShoppingCart}  iconBg="bg-blue-50"   trend="+8%" />
        <StatCard label="Avg Basket"   value={formatCurrency(d.today?.sales_count > 0 ? (d.today?.revenue ?? 0) / d.today.sales_count : 0)} sub="Per transaction" icon={TrendingUp} iconBg="bg-blue-50" />
        <StatCard label="Low Stock"    value={d.low_stock_count ?? 0}                  sub="Items need reorder"  icon={AlertTriangle}  iconBg={d.low_stock_count > 0 ? 'bg-orange-50' : 'bg-blue-50'} />
      </div>

      {/* Sales trend + Top products */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-lg p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900 text-base">Sales Trend</h2>
            <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded-full">Last 30 days</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => v?.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${currencySymbol}${v}`} />
              <Tooltip formatter={v => [formatCurrency(v as number), 'Revenue']}
                contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
              <Area type="monotone" dataKey="revenue" stroke="#2563eb" fill="url(#blueGrad)" strokeWidth={2.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base mb-4">Top Selling Items</h2>
          {topProducts.length > 0 ? (
            <div className="space-y-3">
              {topProducts.slice(0, 6).map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-sm font-bold text-blue-600 flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.quantity} units sold</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{formatCurrency(p.revenue ?? 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm flex-col gap-2">
              <Package size={32} className="text-gray-200" />
              <span>No sales yet</span>
            </div>
          )}
        </div>
      </div>

      {/* Payment breakdown + Open orders */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base mb-4">Payment Methods</h2>
          {paymentBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={paymentBreakdown} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="total" nameKey="method">
                  {paymentBreakdown.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Legend formatter={(v: string) => v.replace('_', ' ')} iconSize={10} />
                <Tooltip formatter={v => formatCurrency(v as number)} contentStyle={{ borderRadius: '10px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No payment data yet</div>
          )}
        </div>

        <div className="xl:col-span-2 bg-white rounded-lg p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-base flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse inline-block" />
              Held Orders
            </h2>
          </div>
          {openOrders.length > 0 ? (
            <div className="space-y-2">
              {openOrders.slice(0, 5).map((order: any) => (
                <div key={order.id} className="flex items-center gap-3 p-3 rounded-md bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <ShoppingCart size={14} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{order.reference}</p>
                    <p className="text-xs text-gray-400">{order.cart_data?.items?.length ?? 0} items</p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                    {order.order_status ?? 'held'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm flex-col gap-2">
              <ShoppingCart size={32} className="text-gray-200" />
              <span>No held orders</span>
            </div>
          )}
        </div>
      </div>

      {/* Month summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Month Revenue',   value: formatCurrency(d.month?.revenue ?? 0), icon: TrendingUp },
          { label: 'Month Sales',     value: `${d.month?.sales_count ?? 0} sales`,  icon: ShoppingCart },
          { label: 'Month Customers', value: d.month?.customers ?? 0,               icon: Users },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-white rounded-lg p-5 shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="w-10 h-10 rounded-md bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">{label}</p>
              <p className="text-lg font-bold text-gray-900">{value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
