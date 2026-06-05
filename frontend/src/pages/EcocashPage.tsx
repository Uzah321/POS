import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ecocashApi, branchesApi } from '../api';
import { Plus, Search, Download, Loader2, X, Smartphone, TrendingUp, TrendingDown, DollarSign, RotateCcw, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const TYPE_LABELS: Record<string, string> = {
  deposit:          'Deposit (Cash In)',
  withdrawal:       'Withdrawal (Cash Out)',
  float_top_up:     'Float Top-Up',
  float_withdrawal: 'Float Withdrawal',
  commission:       'Commission',
};

const TYPE_COLORS: Record<string, string> = {
  deposit:          'bg-green-100 text-green-700',
  withdrawal:       'bg-blue-100 text-blue-700',
  float_top_up:     'bg-purple-100 text-purple-700',
  float_withdrawal: 'bg-orange-100 text-orange-700',
  commission:       'bg-yellow-100 text-yellow-700',
};

const schema = z.object({
  branch_id:         z.coerce.number().min(1, 'Branch required'),
  type:              z.enum(['deposit', 'withdrawal', 'float_top_up', 'float_withdrawal', 'commission']),
  ecocash_reference: z.string().optional(),
  customer_phone:    z.string().optional(),
  amount:            z.coerce.number().min(0.01, 'Amount required'),
  commission_rate:   z.coerce.number().min(0).max(100).default(0),
  transaction_date:  z.string().min(1, 'Date required'),
  notes:             z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

function TransactionModal({ branches, onClose, isCashier }: { branches: any[]; onClose: () => void; isCashier?: boolean }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      transaction_date: new Date().toISOString().split('T')[0],
      commission_rate: 0,
      type: 'deposit',
    },
  });
  const txType = watch('type');

  // Cashiers can only record deposits and withdrawals
  const allowedTypes = isCashier
    ? { deposit: TYPE_LABELS.deposit, withdrawal: TYPE_LABELS.withdrawal }
    : TYPE_LABELS;

  const mutation = useMutation({
    mutationFn: (d: FormData) => ecocashApi.create(d),
    onSuccess: () => {
      toast.success('Transaction recorded');
      qc.invalidateQueries({ queryKey: ['ecocash'] });
      qc.invalidateQueries({ queryKey: ['ecocash-summary'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const showCommission = txType === 'deposit' || txType === 'withdrawal';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-bold text-gray-900">Record EcoCash Transaction</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Branch *</label>
              <select {...register('branch_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Select branch...</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {errors.branch_id && <p className="text-red-500 text-xs mt-1">{errors.branch_id.message}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Transaction Type *</label>
              <select {...register('type')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                {Object.entries(allowedTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Amount *</label>
              <input type="number" step="0.01" {...register('amount')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Date *</label>
              <input type="date" {...register('transaction_date')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          {showCommission && (
            <div>
              <label className="text-sm font-medium text-gray-700">Commission Rate (%)</label>
              <input type="number" step="0.01" min="0" max="100" {...register('commission_rate')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="e.g. 3.5" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Customer Phone</label>
              <input {...register('customer_phone')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="+263..." />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">EcoCash Reference</label>
              <input {...register('ecocash_reference')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="TXN123..." />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Notes</label>
            <textarea {...register('notes')} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />} Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function EcocashPage() {
  const { hasRole, user } = useAuthStore();
  const isCashier = hasRole('cashier');

  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [filterType, setFilterType] = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [branchId, setBranchId]   = useState(isCashier ? String(user?.branch?.id ?? '') : '');
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().split('T')[0]);
  const [modal, setModal]         = useState(false);
  const [tab, setTab]             = useState<'list' | 'summary'>('list');
  const qc = useQueryClient();

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []) });
  const branches = branchData || [];

  const params = { search, page, per_page: 20, type: filterType || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, branch_id: branchId || undefined };

  const { data, isLoading } = useQuery({
    queryKey: ['ecocash', params],
    queryFn: () => ecocashApi.list(params).then(r => r.data?.data),
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['ecocash-summary', summaryDate, branchId],
    queryFn: () => ecocashApi.summary({ date: summaryDate, branch_id: branchId || undefined }).then(r => r.data?.data),
  });

  const reverseMutation = useMutation({
    mutationFn: (id: number) => ecocashApi.reverse(id),
    onSuccess: () => { toast.success('Reversed'); qc.invalidateQueries({ queryKey: ['ecocash'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const handleExport = async () => {
    try {
      const res = await ecocashApi.exportCsv(params);
      downloadBlob(res.data, `ecocash-${dateFrom || 'all'}.csv`);
    } catch { toast.error('Export failed'); }
  };

  const txs = data?.data || [];
  const meta = data?.meta;
  const summary = summaryData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">EcoCash</h1>
          <p className="text-gray-500 text-sm">
            {isCashier ? 'Record customer deposits and withdrawals' : 'Agent banking — deposits, withdrawals & float'}
          </p>
        </div>
        <button type="button" onClick={() => setModal(true)} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm">
          <Plus size={16} /> Record Transaction
        </button>
      </div>

      {/* Cashier quick-action cards */}
      {isCashier && (
        <div className="grid grid-cols-2 gap-4">
          <button type="button" onClick={() => setModal(true)}
            className="bg-green-50 border-2 border-green-200 hover:border-green-400 rounded-2xl p-6 flex flex-col items-center gap-3 transition-all group">
            <div className="w-14 h-14 bg-green-100 group-hover:bg-green-200 rounded-full flex items-center justify-center transition-all">
              <ArrowDownCircle size={28} className="text-green-600" />
            </div>
            <div className="text-center">
              <p className="font-bold text-gray-900 text-lg">Cash Deposit</p>
              <p className="text-sm text-gray-500">Customer brings cash → receives EcoCash</p>
            </div>
          </button>
          <button type="button" onClick={() => setModal(true)}
            className="bg-blue-50 border-2 border-blue-200 hover:border-blue-400 rounded-2xl p-6 flex flex-col items-center gap-3 transition-all group">
            <div className="w-14 h-14 bg-blue-100 group-hover:bg-blue-200 rounded-full flex items-center justify-center transition-all">
              <ArrowUpCircle size={28} className="text-blue-600" />
            </div>
            <div className="text-center">
              <p className="font-bold text-gray-900 text-lg">Cash Withdrawal</p>
              <p className="text-sm text-gray-500">Customer sends EcoCash → receives cash</p>
            </div>
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(['list', 'summary'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'list' ? 'Transactions' : 'Daily Summary'}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={summaryDate} onChange={e => setSummaryDate(e.target.value)} className="mt-1 block border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Branch</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className="mt-1 block border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">All branches</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {summaryLoading ? (
            <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-green-500" /></div>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2"><TrendingDown size={18} className="text-green-500" /><span className="text-sm text-gray-500">Deposits</span></div>
                  <p className="text-2xl font-bold text-gray-900">${Number(summary.total_deposits).toFixed(2)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2"><TrendingUp size={18} className="text-blue-500" /><span className="text-sm text-gray-500">Withdrawals</span></div>
                  <p className="text-2xl font-bold text-gray-900">${Number(summary.total_withdrawals).toFixed(2)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2"><DollarSign size={18} className="text-yellow-500" /><span className="text-sm text-gray-500">Commission</span></div>
                  <p className="text-2xl font-bold text-gray-900">${Number(summary.total_commission).toFixed(2)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2"><Smartphone size={18} className="text-purple-500" /><span className="text-sm text-gray-500">Closing Float</span></div>
                  <p className="text-2xl font-bold text-gray-900">${Number(summary.closing_float).toFixed(2)}</p>
                </div>
              </div>

              {summary.transactions?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">Today's Transactions ({summary.transaction_count})</div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50"><tr>{['Reference', 'Type', 'Phone', 'EcoCash Ref', 'Amount', 'Commission', 'Float After'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {summary.transactions.map((tx: any) => (
                          <tr key={tx.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-xs font-mono text-gray-600">{tx.reference}</td>
                            <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[tx.type]}`}>{TYPE_LABELS[tx.type] ?? tx.type}</span></td>
                            <td className="px-4 py-3 text-sm text-gray-600">{tx.customer_phone || '—'}</td>
                            <td className="px-4 py-3 text-xs font-mono text-gray-500">{tx.ecocash_reference || '—'}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900">${Number(tx.amount).toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-yellow-600">${Number(tx.commission_amount).toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm text-purple-700 font-medium">${Number(tx.float_after).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {tab === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Filters */}
          <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search reference, phone..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            {!isCashier && (
              <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">All types</option>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            {!isCashier && (
              <button type="button" onClick={handleExport} className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
                <Download size={14} /> Export CSV
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-green-500" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>{['Reference', 'Date', 'Type', 'Phone', 'EcoCash Ref', 'Amount', 'Comm %', 'Commission', 'Float After', 'Status', ''].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {txs.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-12 text-gray-400"><Smartphone size={32} className="mx-auto mb-2" /><p>No transactions found</p></td></tr>
                  ) : txs.map((tx: any) => (
                    <tr key={tx.id} className={`hover:bg-gray-50 ${tx.status === 'reversed' ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 text-xs font-mono text-gray-600">{tx.reference}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(tx.transaction_date), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[tx.type]}`}>{TYPE_LABELS[tx.type] ?? tx.type}</span></td>
                      <td className="px-4 py-3 text-sm text-gray-600">{tx.customer_phone || '—'}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{tx.ecocash_reference || '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">${Number(tx.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{tx.commission_rate}%</td>
                      <td className="px-4 py-3 text-sm text-yellow-600">${Number(tx.commission_amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-purple-700">${Number(tx.float_after).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tx.status === 'completed' ? 'bg-green-100 text-green-700' : tx.status === 'reversed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {tx.status === 'completed' && !isCashier && (
                          <button type="button" onClick={() => { if (confirm('Reverse this transaction?')) reverseMutation.mutate(tx.id); }}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Reverse">
                            <RotateCcw size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {meta && meta.last_page > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">Showing {meta.from}–{meta.to} of {meta.total}</p>
              <div className="flex gap-2">
                <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">Prev</button>
                <button type="button" disabled={page === meta.last_page} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {modal && <TransactionModal branches={branches} onClose={() => setModal(false)} isCashier={isCashier} />}
    </div>
  );
}
