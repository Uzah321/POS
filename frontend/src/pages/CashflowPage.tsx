import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cashflowApi, branchesApi } from '../api';
import { Plus, Search, Download, Loader2, X, Banknote, TrendingUp, TrendingDown, Edit, Trash2 } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const CATEGORIES = [
  { value: 'rental',           label: 'Rental Income' },
  { value: 'salary',           label: 'Salary / Wages' },
  { value: 'safe_deposit',     label: 'Safe Deposit' },
  { value: 'safe_withdrawal',  label: 'Safe Withdrawal' },
  { value: 'ecocash_commission', label: 'EcoCash Commission' },
  { value: 'loan',             label: 'Loan' },
  { value: 'utilities',        label: 'Utilities' },
  { value: 'other',            label: 'Other' },
];

const CATEGORY_COLORS: Record<string, string> = {
  rental:             'bg-blue-100 text-blue-700',
  salary:             'bg-red-100 text-red-700',
  safe_deposit:       'bg-purple-100 text-purple-700',
  safe_withdrawal:    'bg-orange-100 text-orange-700',
  ecocash_commission: 'bg-yellow-100 text-yellow-700',
  loan:               'bg-pink-100 text-pink-700',
  utilities:          'bg-gray-100 text-gray-700',
  other:              'bg-slate-100 text-slate-700',
};

const schema = z.object({
  branch_id:      z.coerce.number().min(1, 'Branch required'),
  flow_type:      z.enum(['inflow', 'outflow']),
  category:       z.string().min(1, 'Category required'),
  description:    z.string().min(1, 'Description required'),
  amount:         z.coerce.number().min(0.01, 'Amount required'),
  currency:       z.string().default('USD'),
  entry_date:     z.string().min(1, 'Date required'),
  payment_method: z.string().default('cash'),
  notes:          z.string().optional(),
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

function EntryModal({ entry, branches, onClose }: { entry?: any; branches: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: entry ? {
      ...entry,
      branch_id: entry.branch?.id ?? entry.branch_id,
      entry_date: entry.entry_date?.split('T')[0] ?? entry.entry_date,
    } : {
      entry_date: new Date().toISOString().split('T')[0],
      flow_type: 'inflow',
      currency: 'USD',
      payment_method: 'cash',
    },
  });

  const mutation = useMutation({
    mutationFn: (d: FormData) => entry ? cashflowApi.update(entry.id, d) : cashflowApi.create(d),
    onSuccess: () => {
      toast.success(entry ? 'Entry updated' : 'Entry recorded');
      qc.invalidateQueries({ queryKey: ['cashflow'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-bold text-gray-900">{entry ? 'Edit Entry' : 'Record Cashflow Entry'}</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Branch *</label>
              <select {...register('branch_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">Select branch...</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {errors.branch_id && <p className="text-red-500 text-xs mt-1">{errors.branch_id.message}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Flow Type *</label>
              <select {...register('flow_type')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="inflow">Inflow (Money In)</option>
                <option value="outflow">Outflow (Money Out)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Category *</label>
              <select {...register('category')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">Select category...</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Amount *</label>
              <input type="number" step="0.01" {...register('amount')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Description *</label>
            <input {...register('description')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Brief description..." />
            {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Date *</label>
              <input type="date" {...register('entry_date')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Currency</label>
              <select {...register('currency')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="USD">USD</option>
                <option value="ZWL">ZWL</option>
                <option value="ZAR">ZAR</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Payment Method</label>
              <select {...register('payment_method')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="cash">Cash</option>
                <option value="ecocash">EcoCash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Notes</label>
            <textarea {...register('notes')} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />} {entry ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CashflowPage() {
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [filterCat, setFilterCat] = useState('');
  const [filterFlow, setFilterFlow] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [branchId, setBranchId] = useState('');
  const [modal, setModal]       = useState<{ open: boolean; entry?: any }>({ open: false });
  const qc = useQueryClient();

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []) });
  const branches = branchData || [];

  const params = {
    search, page, per_page: 20,
    category: filterCat || undefined,
    flow_type: filterFlow || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    branch_id: branchId || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['cashflow', params],
    queryFn: () => cashflowApi.list(params).then(r => r.data?.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => cashflowApi.delete(id),
    onSuccess: () => { toast.success('Entry deleted'); qc.invalidateQueries({ queryKey: ['cashflow'] }); },
    onError: () => toast.error('Delete failed'),
  });

  const handleExport = async () => {
    try {
      const res = await cashflowApi.exportCsv(params);
      downloadBlob(res.data, `cashflow-${dateFrom || 'all'}.csv`);
    } catch { toast.error('Export failed'); }
  };

  const entries = data?.entries?.data || [];
  const meta    = data?.entries?.meta;
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cashflow</h1>
          <p className="text-gray-500 text-sm">Track rentals, salaries, safe transfers & other cashflow</p>
        </div>
        <button type="button" onClick={() => setModal({ open: true })} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm">
          <Plus size={16} /> Record Entry
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-md border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2"><TrendingDown size={18} className="text-green-500" /><span className="text-sm text-gray-500">Total Inflow</span></div>
            <p className="text-2xl font-bold text-green-600">${Number(summary.total_inflow || 0).toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-md border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2"><TrendingUp size={18} className="text-red-500" /><span className="text-sm text-gray-500">Total Outflow</span></div>
            <p className="text-2xl font-bold text-red-600">${Number(summary.total_outflow || 0).toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-md border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2"><Banknote size={18} className="text-blue-500" /><span className="text-sm text-gray-500">Net Cashflow</span></div>
            <p className={`text-2xl font-bold ${Number(summary.net_cashflow || 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
              ${Number(summary.net_cashflow || 0).toFixed(2)}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search entries..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <select value={filterFlow} onChange={e => { setFilterFlow(e.target.value); setPage(1); }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">All flows</option>
            <option value="inflow">Inflow</option>
            <option value="outflow">Outflow</option>
          </select>
          <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1); }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">All branches</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
          <button type="button" onClick={handleExport} className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
            <Download size={14} /> Export CSV
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-teal-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>{['Reference', 'Date', 'Flow', 'Category', 'Description', 'Amount', 'Currency', 'Method', 'Branch', ''].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-12 text-gray-400"><Banknote size={32} className="mx-auto mb-2" /><p>No cashflow entries</p></td></tr>
                ) : entries.map((e: any) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{e.reference}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(e.entry_date), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${e.flow_type === 'inflow' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {e.flow_type === 'inflow' ? '+ In' : '- Out'}
                      </span>
                    </td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[e.category] ?? 'bg-gray-100 text-gray-700'}`}>{CATEGORIES.find(c => c.value === e.category)?.label ?? e.category}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px] truncate">{e.description}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${e.flow_type === 'inflow' ? 'text-green-600' : 'text-red-600'}`}>{e.flow_type === 'inflow' ? '+' : '-'}${Number(e.amount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{e.currency}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 capitalize">{e.payment_method?.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{e.branch?.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setModal({ open: true, entry: e })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={13} /></button>
                        <button type="button" onClick={() => { if (confirm('Delete this entry?')) deleteMutation.mutate(e.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>

      {modal.open && <EntryModal entry={modal.entry} branches={branches} onClose={() => setModal({ open: false })} />}
    </div>
  );
}
