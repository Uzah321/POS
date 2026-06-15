import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import api from '../lib/axios';
import { useCurrencyStore } from '../stores/currencyStore';

interface EodSummary {
  date: string;
  total_revenue: number;
  total_transactions: number;
  cash_sales: number;
  card_sales: number;
  mobile_money_sales: number;
  other_sales: number;
  total_expenses: number;
  total_refunds: number;
  net_revenue: number;
  cashier_breakdown: { cashier: string; username: string; transactions: number; revenue: number }[];
  shift_ends: { user: { name: string }; declared_cash: number; expected_cash: number; variance: number; status: string }[];
}

interface FormData {
  date: string;
  notes: string;
  opening_cash: number;
}

export default function DayEndPage() {
  const { format } = useCurrencyStore();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: { date: today, notes: '', opening_cash: 0 },
  });

  const selectedDate = watch('date');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['eod-summary', selectedDate],
    queryFn: () => api.get('/end-of-day/summary', { params: { date: selectedDate } }).then(r => r.data.data as EodSummary),
  });

  const { data: historyData } = useQuery({
    queryKey: ['eod-history'],
    queryFn: () => api.get('/end-of-day').then(r => r.data.data),
  });

  const history: any[] = Array.isArray(historyData) ? historyData : historyData?.data ?? [];

  const submitMutation = useMutation({
    mutationFn: (data: FormData) => api.post('/end-of-day', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eod-summary'] });
      qc.invalidateQueries({ queryKey: ['eod-history'] });
    },
  });

  const onSubmit = (data: FormData) => {
    submitMutation.mutate({ ...data, opening_cash: Number(data.opening_cash) });
  };

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="bg-white border border-gray-200 rounded-md p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Day End " EOD</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Date:</label>
          <input
            type="date"
            {...register('date')}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Summary grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-md h-20 animate-pulse" />
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Total Revenue" value={format(summary.total_revenue)} />
            <Stat label="Transactions" value={summary.total_transactions.toString()} />
            <Stat label="Cash Sales" value={format(summary.cash_sales)} />
            <Stat label="Card Sales" value={format(summary.card_sales)} />
            <Stat label="Mobile Money" value={format(summary.mobile_money_sales)} />
            <Stat label="Other Payments" value={format(summary.other_sales)} />
            <Stat label="Total Expenses" value={format(summary.total_expenses)} />
            <Stat label="Net Revenue" value={format(summary.net_revenue)} sub="After expenses &amp; refunds" />
          </div>

          {/* Cashier Breakdown */}
          {summary.cashier_breakdown?.length > 0 && (
            <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-medium text-gray-700 text-sm">Cashier Breakdown</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Cashier</th>
                    <th className="px-4 py-2 text-left">Username</th>
                    <th className="px-4 py-2 text-right">Transactions</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summary.cashier_breakdown.map((c) => (
                    <tr key={c.username}>
                      <td className="px-4 py-2">{c.cashier}</td>
                      <td className="px-4 py-2 text-gray-500">@{c.username}</td>
                      <td className="px-4 py-2 text-right">{c.transactions}</td>
                      <td className="px-4 py-2 text-right font-medium">{format(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Shift Ends */}
          {summary.shift_ends?.length > 0 && (
            <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 font-medium text-gray-700 text-sm">Shift End Reconciliation</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Cashier</th>
                    <th className="px-4 py-2 text-right">Expected</th>
                    <th className="px-4 py-2 text-right">Declared</th>
                    <th className="px-4 py-2 text-right">Variance</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summary.shift_ends.map((s, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">{s.user?.name ?? '"'}</td>
                      <td className="px-4 py-2 text-right">{format(s.expected_cash)}</td>
                      <td className="px-4 py-2 text-right">{format(s.declared_cash)}</td>
                      <td className={`px-4 py-2 text-right font-medium ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {s.variance >= 0 ? '+' : ''}{format(s.variance)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="text-gray-400">No data for this date.</p>
      )}

      {/* Submit EOD form */}
      <div className="bg-white rounded-md border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Submit End of Day</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col md:flex-row gap-4 items-start">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Opening Cash for Next Day</label>
            <input
              type="number"
              step="0.01"
              min="0"
              {...register('opening_cash', { min: { value: 0, message: 'Must be â‰¥ 0' } })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
            {errors.opening_cash && <p className="text-red-500 text-xs mt-1">{errors.opening_cash.message}</p>}
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Manager Notes</label>
            <input
              {...register('notes')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              placeholder="Optional remarks..."
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg text-sm transition-colors"
            >
              {submitMutation.isPending ? 'Submitting...' : 'Close Day'}
            </button>
          </div>
        </form>
        {submitMutation.isSuccess && (
          <p className="text-green-600 text-sm mt-3">Day end submitted successfully.</p>
        )}
        {submitMutation.isError && (
          <p className="text-red-500 text-sm mt-3">
            {(submitMutation.error as any)?.response?.data?.message ?? 'Failed to submit. This day may already be closed.'}
          </p>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-medium text-gray-700 text-sm">Recent End-of-Day Records</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-right">Revenue</th>
                <th className="px-4 py-2 text-right">Transactions</th>
                <th className="px-4 py-2 text-right">Opening Cash</th>
                <th className="px-4 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2 font-medium">{h.date}</td>
                  <td className="px-4 py-2 text-right">{format(h.total_revenue)}</td>
                  <td className="px-4 py-2 text-right">{h.total_transactions}</td>
                  <td className="px-4 py-2 text-right">{format(h.opening_cash ?? 0)}</td>
                  <td className="px-4 py-2 text-gray-500 truncate max-w-xs">{h.notes ?? '"'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
