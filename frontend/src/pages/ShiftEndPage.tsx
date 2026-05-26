import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import api from '../lib/axios';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';

interface SaleSummaryItem {
  id: number;
  reference: string;
  completed_at: string;
  total: number;
  items_count: number;
  payments: { method: string; amount: number }[];
}

interface ShiftSummary {
  shift_start: string;
  total_sales: number;
  total_transactions: number;
  cash_sales: number;
  card_sales: number;
  mobile_money_sales: number;
  other_sales: number;
  expected_cash: number;
  sales: SaleSummaryItem[];
}

interface ShiftEndRecord {
  id: number;
  shift_end: string;
  shift_start: string;
  total_sales: number;
  total_transactions: number;
  declared_cash: number;
  expected_cash: number;
  variance: number;
  status: string;
  notes: string | null;
  user?: { name: string; username: string };
  branch?: { name: string };
}

interface FormData {
  declared_cash: string;
  notes: string;
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
};

export default function ShiftEndPage() {
  const { hasRole, user } = useAuthStore();
  const { format } = useCurrencyStore();
  const qc = useQueryClient();
  const [submitted, setSubmitted] = useState(false);

  const isCashier = hasRole('cashier');
  const isManager = hasRole('admin') || hasRole('manager');

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: { declared_cash: '', notes: '' },
  });

  const declaredCashValue = parseFloat(watch('declared_cash') || '0') || 0;

  // Load shift summary (cashiers only)
  const { data: summary, isLoading: loadingSummary, refetch: refetchSummary } = useQuery({
    queryKey: ['shift-summary'],
    queryFn: () => api.get('/shift-end/summary').then(r => r.data.data as ShiftSummary),
    enabled: isCashier,
    refetchInterval: 30000, // auto-refresh every 30s
  });

  // Load history
  const { data: historyData } = useQuery({
    queryKey: ['shift-history'],
    queryFn: () => api.get('/shift-end').then(r => r.data.data),
  });

  const history: ShiftEndRecord[] = Array.isArray(historyData)
    ? historyData
    : (historyData as any)?.data ?? [];

  const submitMutation = useMutation({
    mutationFn: (data: { declared_cash: number; notes: string }) => api.post('/shift-end', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-summary'] });
      qc.invalidateQueries({ queryKey: ['shift-history'] });
      qc.invalidateQueries({ queryKey: ['my-sales'] }); // clears cashier's My Sales for new shift
      setSubmitted(true);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/shift-end/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-history'] }),
  });

  const onSubmit = (data: FormData) => {
    submitMutation.mutate({ declared_cash: parseFloat(data.declared_cash), notes: data.notes });
  };

  const variance = summary ? declaredCashValue - summary.expected_cash : 0;

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending:  'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  // ─── Success screen ──────────────────────────────────────────────────────────
  if (isCashier && submitted) {
    return (
      <div className="p-6 max-w-lg mx-auto mt-20 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Shift Closed!</h2>
        <p className="text-gray-500 text-sm mb-6">Your shift has been submitted and is awaiting manager approval.</p>
        <button
          onClick={() => { setSubmitted(false); refetchSummary(); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg"
        >
          Start New Shift
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift End</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {isCashier
              ? `Close your shift and declare your cash — ${user?.name ?? ''}`
              : 'Manage and approve cashier shift closures'}
          </p>
        </div>
        {isCashier && summary && (
          <button
            onClick={() => refetchSummary()}
            className="text-xs text-blue-600 hover:underline"
          >
            Refresh
          </button>
        )}
      </div>

      {/* ── CASHIER VIEW ─────────────────────────────────────────────── */}
      {isCashier && (
        <>
          {/* Top stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {loadingSummary
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-gray-100 rounded-xl h-20 animate-pulse" />)
              : [
                  ['Total Revenue', format(summary?.total_sales ?? 0), 'text-blue-700', 'bg-blue-50 border-blue-100'],
                  ['Transactions',  String(summary?.total_transactions ?? 0), 'text-gray-900', 'bg-white border-gray-200'],
                  ['Cash in Drawer',format(summary?.expected_cash ?? 0), 'text-green-700', 'bg-green-50 border-green-100'],
                  ['Shift Started', summary?.shift_start ? new Date(summary.shift_start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '—', 'text-gray-600', 'bg-white border-gray-200'],
                ].map(([label, value, textCls, bgCls]) => (
                  <div key={label} className={`rounded-xl border p-4 ${bgCls}`}>
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className={`text-lg font-bold ${textCls}`}>{value}</p>
                  </div>
                ))}
          </div>

          {/* Payment breakdown */}
          {summary && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Payment Breakdown</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Cash',         summary.cash_sales,         'bg-emerald-50 text-emerald-700'],
                  ['Card',         summary.card_sales,         'bg-blue-50 text-blue-700'],
                  ['Mobile Money', summary.mobile_money_sales, 'bg-purple-50 text-purple-700'],
                  ['Other',        summary.other_sales,        'bg-gray-50 text-gray-700'],
                ].map(([label, amount, cls]) => (
                  <div key={label} className={`rounded-lg p-3 ${cls}`}>
                    <p className="text-xs font-medium opacity-70">{label}</p>
                    <p className="text-base font-bold mt-0.5">{format(amount as number)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sales list */}
          {summary?.sales && summary.sales.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-sm">
                  Sales This Shift
                  <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-normal">{summary.sales.length}</span>
                </h2>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">Ref</th>
                      <th className="px-4 py-2 text-left">Time</th>
                      <th className="px-4 py-2 text-right">Items</th>
                      <th className="px-4 py-2 text-left">Payment</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.sales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{sale.reference}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">
                          {new Date(sale.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{sale.items_count}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {sale.payments.map((p, i) => (
                              <span key={i} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                {METHOD_LABEL[p.method] ?? p.method}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">{format(sale.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 font-semibold text-gray-700 text-right">Total</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-900">{format(summary.total_sales)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {summary?.sales?.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
              No sales recorded for this shift yet.
            </div>
          )}

          {/* Declare cash & close shift */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-800 mb-1">Close Shift</h2>
            <p className="text-sm text-gray-500 mb-4">Count the cash in your drawer and enter the amount below.</p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expected Cash
                  </label>
                  <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm font-semibold text-green-700">
                    {format(summary?.expected_cash ?? 0)}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Actual Cash in Drawer <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    {...register('declared_cash', {
                      required: 'Enter the cash amount',
                      min: { value: 0, message: 'Must be ≥ 0' },
                    })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  {errors.declared_cash && (
                    <p className="text-red-500 text-xs mt-1">{errors.declared_cash.message}</p>
                  )}
                </div>
              </div>

              {/* Live variance */}
              {watch('declared_cash') !== '' && (
                <div className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium ${
                  variance === 0 ? 'bg-gray-50 text-gray-700'
                  : variance > 0 ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
                }`}>
                  <span>Cash Variance</span>
                  <span>{variance >= 0 ? '+' : ''}{format(variance)}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  {...register('notes')}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                  placeholder="Any remarks about discrepancies..."
                />
              </div>

              {submitMutation.isError && (
                <p className="text-red-500 text-sm">
                  {(submitMutation.error as any)?.response?.data?.message ?? 'Failed to submit. Please try again.'}
                </p>
              )}

              <button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitMutation.isPending ? 'Closing Shift...' : 'Close Shift & Submit'}
              </button>
            </form>
          </div>

          {/* Cashier's own past shifts */}
          {history.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-700 text-sm">My Previous Shifts</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-right">Sales</th>
                      <th className="px-4 py-2 text-right">Transactions</th>
                      <th className="px-4 py-2 text-right">Expected</th>
                      <th className="px-4 py-2 text-right">Declared</th>
                      <th className="px-4 py-2 text-right">Variance</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">{new Date(s.shift_end).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="px-4 py-2.5 text-right">{format(s.total_sales)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{s.total_transactions}</td>
                        <td className="px-4 py-2.5 text-right">{format(s.expected_cash)}</td>
                        <td className="px-4 py-2.5 text-right">{format(s.declared_cash)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {s.variance >= 0 ? '+' : ''}{format(s.variance)}
                        </td>
                        <td className="px-4 py-2.5 text-center">{statusBadge(s.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── MANAGER VIEW ─────────────────────────────────────────────── */}
      {isManager && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">All Shift End Records</h2>
            <span className="text-xs text-gray-400">{history.length} record{history.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Cashier</th>
                  <th className="px-4 py-3 text-left">Shift End</th>
                  <th className="px-4 py-3 text-right">Sales</th>
                  <th className="px-4 py-3 text-right">Txns</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Declared</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-gray-400">No shift end records yet.</td>
                  </tr>
                ) : (
                  history.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{s.user?.name ?? '—'}</p>
                        <p className="text-xs text-gray-400">@{s.user?.username}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(s.shift_end).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="px-4 py-3 text-right">{format(s.total_sales)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{s.total_transactions}</td>
                      <td className="px-4 py-3 text-right">{format(s.expected_cash)}</td>
                      <td className="px-4 py-3 text-right">{format(s.declared_cash)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {s.variance >= 0 ? '+' : ''}{format(s.variance)}
                      </td>
                      <td className="px-4 py-3 text-center">{statusBadge(s.status)}</td>
                      <td className="px-4 py-3 text-center">
                        {s.status === 'pending' ? (
                          <button
                            onClick={() => approveMutation.mutate(s.id)}
                            disabled={approveMutation.isPending}
                            className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg disabled:opacity-50"
                          >
                            Approve
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
