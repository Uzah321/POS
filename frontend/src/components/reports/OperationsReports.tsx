import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, subDays } from 'date-fns';
import { FileSpreadsheet, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { reportsApi } from '../../api';
import { useCurrencyStore } from '../../stores/currencyStore';
import { exportToExcel } from '../../utils/excel';

// Restaurant / operations reports shown as tabs on ReportsPage. Each owns its
// query and Excel export; ReportsPage supplies the shared date range + branch.

interface RangeProps {
  from: string;
  to: string;
  branchId: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', mobile_money: 'Mobile Money', bank_transfer: 'Bank Transfer',
  loyalty_points: 'Loyalty Points', credit: 'Account / Credit', other: 'Other',
};
const PAYMENT_COLORS: Record<string, string> = {
  cash: '#10b981', card: '#3b82f6', mobile_money: '#f59e0b', bank_transfer: '#8b5cf6',
  loyalty_points: '#ec4899', credit: '#64748b', other: '#94a3b8',
};
const paymentLabel = (m: string) => PAYMENT_LABELS[m] ?? m;

function rangeParams({ from, to, branchId }: RangeProps) {
  return { date_from: from, date_to: to, ...(branchId ? { branch_id: Number(branchId) } : {}) };
}

function StatCard({ label, value, tone = 'text-gray-900' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-white rounded-md p-5 shadow-sm border border-gray-100">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-md p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md">
      <FileSpreadsheet size={13} /> Export Excel
    </button>
  );
}

function Table({ headers, children, minWidth = 700 }: { headers: string[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="bg-gray-50">
          <tr>{headers.map((h) => <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

const Empty = () => <p className="text-gray-400 text-center py-8">No data for selected period</p>;
const Loading = () => <p className="text-gray-400 text-center py-8">Loading…</p>;

// ── 1. Sales by table ─────────────────────────────────────────────────────────
export function SalesByTableReport(props: RangeProps) {
  const { format: fmt } = useCurrencyStore();
  const { data, isLoading } = useQuery({
    queryKey: ['report-sales-by-table', props.from, props.to, props.branchId],
    queryFn: () => reportsApi.salesByTable(rangeParams(props)).then((r) => r.data?.data ?? []),
    staleTime: 0,
  });
  const rows: any[] = Array.isArray(data) ? data : [];
  const total = rows.reduce((s, r) => s + r.revenue, 0);

  const exportXlsx = () => exportToExcel(
    [['Table', 'Orders', 'Revenue', 'Avg Order', 'Discounts', 'Share %'],
     ...rows.map((r) => [r.table, r.transactions, r.revenue, r.avg_sale, r.discounts, total ? +(r.revenue / total * 100).toFixed(1) : 0])],
    `sales-by-table-${props.from}-${props.to}`,
  );

  return (
    <Panel title="Sales by Table" action={rows.length > 0 && <ExportButton onClick={exportXlsx} />}>
      {isLoading ? <Loading /> : rows.length === 0 ? <Empty /> : (
        <div className="space-y-5">
          <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 34)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="table" tick={{ fontSize: 11 }} width={80} />
              <Tooltip formatter={(v) => [fmt(v as number), 'Revenue']} />
              <Bar dataKey="revenue" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Table headers={['Table', 'Orders', 'Revenue', 'Avg Order', 'Discounts', 'Share']}>
            {rows.map((r) => (
              <tr key={r.table} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium">{r.table}</td>
                <td className="px-4 py-2.5">{r.transactions}</td>
                <td className="px-4 py-2.5 font-semibold text-amber-600">{fmt(r.revenue)}</td>
                <td className="px-4 py-2.5">{fmt(r.avg_sale)}</td>
                <td className="px-4 py-2.5">{r.discounts > 0 ? fmt(r.discounts) : '-'}</td>
                <td className="px-4 py-2.5 text-gray-500">{total ? (r.revenue / total * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Panel>
  );
}

// ── 2. Sales by waiter ────────────────────────────────────────────────────────
export function SalesByWaiterReport(props: RangeProps) {
  const { format: fmt } = useCurrencyStore();
  const { data, isLoading } = useQuery({
    queryKey: ['report-sales-by-waiter', props.from, props.to, props.branchId],
    queryFn: () => reportsApi.salesByWaiter(rangeParams(props)).then((r) => r.data?.data ?? []),
    staleTime: 0,
  });
  const rows: any[] = Array.isArray(data) ? data : [];

  const exportXlsx = () => exportToExcel(
    [['Waiter', 'Orders', 'Revenue', 'Avg Order', 'Items Sold', 'Tables Served', 'Discounts Given', 'Voided Orders', 'Voided Amount'],
     ...rows.map((r) => [r.name, r.transactions, r.revenue, r.avg_sale, r.items_sold, r.tables_served, r.discounts, r.voids, r.void_amount])],
    `sales-by-waiter-${props.from}-${props.to}`,
  );

  return (
    <Panel title="Sales by Waiter" action={rows.length > 0 && <ExportButton onClick={exportXlsx} />}>
      <p className="text-xs text-gray-400 -mt-2 mb-4">Each order is credited to the staff member logged in when it was rung up.</p>
      {isLoading ? <Loading /> : rows.length === 0 ? <Empty /> : (
        <Table headers={['Waiter', 'Orders', 'Revenue', 'Avg Order', 'Items Sold', 'Tables', 'Discounts', 'Voided']} minWidth={860}>
          {rows.map((r) => (
            <tr key={r.user_id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 font-medium">{r.name}</td>
              <td className="px-4 py-2.5">{r.transactions}</td>
              <td className="px-4 py-2.5 font-semibold text-amber-600">{fmt(r.revenue)}</td>
              <td className="px-4 py-2.5">{fmt(r.avg_sale)}</td>
              <td className="px-4 py-2.5">{+r.items_sold.toFixed(3)}</td>
              <td className="px-4 py-2.5">{r.tables_served}</td>
              <td className="px-4 py-2.5">{r.discounts > 0 ? fmt(r.discounts) : '-'}</td>
              <td className="px-4 py-2.5">
                {r.voids > 0 ? <span className="text-red-600 font-semibold">{r.voids} · {fmt(r.void_amount)}</span> : <span className="text-gray-300">0</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

// ── 3. Payment report ─────────────────────────────────────────────────────────
export function PaymentsReport(props: RangeProps) {
  const { format: fmt } = useCurrencyStore();
  const { data, isLoading } = useQuery({
    queryKey: ['report-payments', props.from, props.to, props.branchId],
    queryFn: () => reportsApi.payments(rangeParams(props)).then((r) => r.data?.data),
    staleTime: 0,
  });
  const methods: any[] = data?.methods ?? [];
  const daily: any[] = data?.daily ?? [];
  const methodKeys = methods.map((m) => m.method);

  const exportXlsx = () => exportToExcel(
    [['Payment Method', 'Payments', 'Amount', 'Share %'],
     ...methods.map((m) => [paymentLabel(m.method), m.transactions, m.amount, data.total ? +(m.amount / data.total * 100).toFixed(1) : 0]),
     ['TOTAL', '', data?.total ?? 0, ''],
     [],
     ['Date', ...methodKeys.map(paymentLabel), 'Total'],
     ...daily.map((d) => [d.date, ...methodKeys.map((k) => d[k] ?? 0), methodKeys.reduce((s, k) => s + (d[k] ?? 0), 0)])],
    `payments-${props.from}-${props.to}`,
  );

  if (isLoading) return <Panel title="Payment Report"><Loading /></Panel>;
  if (!data || methods.length === 0) return <Panel title="Payment Report"><Empty /></Panel>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Collected" value={fmt(data.total)} tone="text-emerald-600" />
        <StatCard label="Sales Total" value={fmt(data.sales_total)} tone="text-blue-600" />
        <StatCard label="Transactions" value={data.transactions} />
      </div>
      <Panel title="By Payment Method" action={<ExportButton onClick={exportXlsx} />}>
        <p className="text-xs text-gray-400 -mt-2 mb-4">Cash is shown net of change given back to customers.</p>
        <Table headers={['Method', 'Payments', 'Amount', 'Share']} minWidth={480}>
          {methods.map((m) => (
            <tr key={m.method} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 font-medium">
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: PAYMENT_COLORS[m.method] ?? '#94a3b8' }} />
                {paymentLabel(m.method)}
              </td>
              <td className="px-4 py-2.5">{m.transactions}</td>
              <td className="px-4 py-2.5 font-semibold">{fmt(m.amount)}</td>
              <td className="px-4 py-2.5 text-gray-500">{data.total ? (m.amount / data.total * 100).toFixed(1) : 0}%</td>
            </tr>
          ))}
        </Table>
      </Panel>
      {daily.length > 1 && (
        <Panel title="Daily Breakdown">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name) => [fmt(v as number), paymentLabel(String(name))]} />
              <Legend formatter={(v) => paymentLabel(String(v))} />
              {methodKeys.map((k) => <Bar key={k} dataKey={k} stackId="pay" fill={PAYMENT_COLORS[k] ?? '#94a3b8'} />)}
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}

// ── 4. Day comparison ─────────────────────────────────────────────────────────
function Delta({ a, b }: { a: number; b: number }) {
  if (!a && !b) return <span className="text-gray-300">-</span>;
  if (!b) return <span className="text-gray-400 text-xs">new</span>;
  const pct = ((a - b) / Math.abs(b)) * 100;
  if (Math.abs(pct) < 0.05) return <span className="inline-flex items-center gap-0.5 text-gray-400 text-xs"><Minus size={12} />0%</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function DayComparisonReport({ branchId }: { branchId: string }) {
  const { format: fmt } = useCurrencyStore();
  const [dateA, setDateA] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateB, setDateB] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const { data, isLoading } = useQuery({
    queryKey: ['report-day-comparison', dateA, dateB, branchId],
    queryFn: () => reportsApi.dayComparison({ date_a: dateA, date_b: dateB, ...(branchId ? { branch_id: Number(branchId) } : {}) }).then((r) => r.data?.data),
    staleTime: 0,
  });
  const a = data?.a;
  const b = data?.b;

  const metrics: Array<[string, string, boolean]> = [
    ['Revenue', 'revenue', true], ['Orders', 'transactions', false], ['Avg Order', 'avg_sale', true],
    ['Gross Profit', 'gross_profit', true], ['Items Sold', 'items_sold', false], ['Discounts', 'discounts', true],
    ['Voided Orders', 'voids', false], ['Voided Amount', 'void_amount', true], ['Refunds', 'refunds', true],
  ];
  const show = (v: number, money: boolean) => money ? fmt(v ?? 0) : +(v ?? 0).toFixed(3);
  const payMethods = Array.from(new Set([...(a?.payments ?? []), ...(b?.payments ?? [])].map((p: any) => p.method)));
  const payAmount = (day: any, m: string) => day?.payments?.find((p: any) => p.method === m)?.amount ?? 0;
  const allHours = (a?.hourly ?? []).map((h: any, i: number) => ({ hour: `${String(h.hour).padStart(2, '0')}:00`, a: h.revenue, b: b?.hourly?.[i]?.revenue ?? 0 }));
  // Trim the empty hours before the first and after the last sale of either day.
  const busy = allHours.map((h: any) => !!(h.a || h.b));
  const firstBusy = busy.indexOf(true);
  const hourly = firstBusy === -1 ? [] : allHours.slice(firstBusy, busy.lastIndexOf(true) + 1);

  const exportXlsx = () => exportToExcel(
    [['Metric', dateA, dateB, 'Change %'],
     ...metrics.map(([label, key]) => [label, a?.[key] ?? 0, b?.[key] ?? 0, b?.[key] ? +(((a?.[key] ?? 0) - b[key]) / Math.abs(b[key]) * 100).toFixed(1) : '']),
     [],
     ['Payment Method', dateA, dateB],
     ...payMethods.map((m) => [paymentLabel(m), payAmount(a, m), payAmount(b, m)])],
    `day-comparison-${dateA}-vs-${dateB}`,
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-md p-4 shadow-sm border border-gray-100 flex flex-wrap gap-3 items-center">
        <label className="text-sm text-gray-600">Day A:</label>
        <input type="date" value={dateA} onChange={(e) => setDateA(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        <label className="text-sm text-gray-600">compared with Day B:</label>
        <input type="date" value={dateB} onChange={(e) => setDateB(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        {a && <div className="ml-auto"><ExportButton onClick={exportXlsx} /></div>}
      </div>

      {isLoading || !a || !b ? <Panel title="Day Comparison"><Loading /></Panel> : (
        <>
          <Panel title="Summary">
            <Table headers={['Metric', format(new Date(dateA + 'T00:00'), 'EEE d MMM yyyy'), format(new Date(dateB + 'T00:00'), 'EEE d MMM yyyy'), 'Change']} minWidth={560}>
              {metrics.map(([label, key, money]) => (
                <tr key={key} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{label}</td>
                  <td className="px-4 py-2.5 font-semibold">{show(a[key], money)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{show(b[key], money)}</td>
                  <td className="px-4 py-2.5"><Delta a={a[key]} b={b[key]} /></td>
                </tr>
              ))}
            </Table>
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel title="Payments">
              {payMethods.length === 0 ? <Empty /> : (
                <Table headers={['Method', 'Day A', 'Day B', 'Change']} minWidth={420}>
                  {payMethods.map((m) => (
                    <tr key={m} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium">{paymentLabel(m)}</td>
                      <td className="px-4 py-2.5 font-semibold">{fmt(payAmount(a, m))}</td>
                      <td className="px-4 py-2.5 text-gray-600">{fmt(payAmount(b, m))}</td>
                      <td className="px-4 py-2.5"><Delta a={payAmount(a, m)} b={payAmount(b, m)} /></td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
            <Panel title="Top Products">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[['Day A', a], ['Day B', b]].map(([label, day]: any) => (
                  <div key={label}>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{label}</p>
                    {day.top_products.length === 0 ? <p className="text-gray-300">No sales</p> : (
                      <ol className="space-y-1.5">
                        {day.top_products.map((p: any) => (
                          <li key={p.name} className="flex justify-between gap-2">
                            <span className="truncate">{p.name} <span className="text-gray-400">×{+p.qty.toFixed(3)}</span></span>
                            <span className="font-semibold flex-shrink-0">{fmt(p.revenue)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {hourly.length > 0 && (
            <Panel title="Revenue by Hour">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => [fmt(v as number), name === 'a' ? dateA : dateB]} />
                  <Legend formatter={(v) => (v === 'a' ? `Day A (${dateA})` : `Day B (${dateB})`)} />
                  <Bar dataKey="a" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="b" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

// ── 5. Discounts & voids ──────────────────────────────────────────────────────
export function DiscountsVoidsReport(props: RangeProps) {
  const { format: fmt } = useCurrencyStore();
  const { data, isLoading } = useQuery({
    queryKey: ['report-discounts-voids', props.from, props.to, props.branchId],
    queryFn: () => reportsApi.discountsVoids(rangeParams(props)).then((r) => r.data?.data),
    staleTime: 0,
  });
  const dt = (v?: string) => (v ? format(new Date(v.replace(' ', 'T')), 'dd MMM HH:mm') : '-');
  const discountLabel = (r: any) =>
    r.coupon_code ? `Coupon ${r.coupon_code}` : r.discount_type === 'percent' ? `${+r.discount_value}%` : r.discount_type === 'fixed' ? 'Fixed' : 'Item discounts';

  if (isLoading) return <Panel title="Discounts & Voids"><Loading /></Panel>;
  if (!data) return <Panel title="Discounts & Voids"><Empty /></Panel>;
  const { discounts, voids } = data;

  const exportXlsx = () => exportToExcel(
    [['DISCOUNTS', `${props.from} to ${props.to}`],
     ['Reference', 'Date', 'Staff', 'Table', 'Subtotal', 'Discount', 'Type', 'Total'],
     ...discounts.rows.map((r: any) => [r.reference, r.date, r.staff, r.table ?? '', r.subtotal, r.discount, discountLabel(r), r.total]),
     ['', '', '', '', 'TOTAL', discounts.total],
     [],
     ['VOIDS'],
     ['Reference', 'Sale Date', 'Voided At', 'Rang Up By', 'Voided By', 'Reason', 'Table', 'Amount'],
     ...voids.rows.map((r: any) => [r.reference, r.sale_date, r.voided_at, r.rang_by, r.voided_by ?? 'Not recorded', r.reason ?? '', r.table ?? '', r.total]),
     ['', '', '', '', '', '', 'TOTAL', voids.total]],
    `discounts-voids-${props.from}-${props.to}`,
  );

  const StaffTotals = ({ rows, label }: { rows: any[]; label: string }) => rows.length === 0 ? null : (
    <div className="flex flex-wrap gap-2 mb-4">
      {rows.map((s) => (
        <span key={s.name} className="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1">
          <span className="font-semibold">{s.name}</span> · {s.count} {label} · {fmt(s.amount)}
        </span>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Discounted Orders" value={discounts.count} />
        <StatCard label="Total Discounts" value={fmt(discounts.total)} tone="text-amber-600" />
        <StatCard label="Voided Orders" value={voids.count} />
        <StatCard label="Total Voided" value={fmt(voids.total)} tone="text-red-600" />
      </div>

      <Panel title="Discounts" action={<ExportButton onClick={exportXlsx} />}>
        <StaffTotals rows={discounts.by_staff} label="discounts" />
        {discounts.rows.length === 0 ? <Empty /> : (
          <Table headers={['Reference', 'Date', 'Staff', 'Table', 'Subtotal', 'Discount', 'Type', 'Total']} minWidth={860}>
            {discounts.rows.map((r: any) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs">{r.reference}</td>
                <td className="px-4 py-2.5 text-gray-500">{dt(r.date)}</td>
                <td className="px-4 py-2.5">{r.staff}</td>
                <td className="px-4 py-2.5">{r.table ?? '-'}</td>
                <td className="px-4 py-2.5">{fmt(r.subtotal)}</td>
                <td className="px-4 py-2.5 font-semibold text-amber-600">-{fmt(r.discount)}</td>
                <td className="px-4 py-2.5 text-gray-500">{discountLabel(r)}</td>
                <td className="px-4 py-2.5 font-semibold">{fmt(r.total)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Voids">
        <StaffTotals rows={voids.by_staff} label="voids" />
        {voids.rows.length === 0 ? <Empty /> : (
          <Table headers={['Reference', 'Voided At', 'Rang Up By', 'Voided By', 'Reason', 'Table', 'Amount']} minWidth={860}>
            {voids.rows.map((r: any) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs">{r.reference}</td>
                <td className="px-4 py-2.5 text-gray-500">{dt(r.voided_at)}</td>
                <td className="px-4 py-2.5">{r.rang_by}</td>
                <td className="px-4 py-2.5">{r.voided_by ?? <span className="text-gray-400">Not recorded</span>}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.reason ?? '-'}</td>
                <td className="px-4 py-2.5">{r.table ?? '-'}</td>
                <td className="px-4 py-2.5 font-semibold text-red-600">{fmt(r.total)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
