import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salariesApi, branchesApi, usersApi } from '../api';
import { Plus, Search, Download, Loader2, X, Users, CheckCircle, Edit, Trash2 } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.URL.revokeObjectURL(url);
}

const schema = z.object({
  branch_id:           z.coerce.number().min(1),
  employee_id:         z.coerce.number().optional(),
  employee_name:       z.string().min(1),
  position:            z.string().optional(),
  pay_month:           z.string().min(1),
  basic_salary:        z.coerce.number().min(0),
  housing_allowance:   z.coerce.number().min(0).default(0),
  transport_allowance: z.coerce.number().min(0).default(0),
  other_allowances:    z.coerce.number().min(0).default(0),
  paye:                z.coerce.number().min(0).default(0),
  nssa:                z.coerce.number().min(0).default(0),
  other_deductions:    z.coerce.number().min(0).default(0),
  notes:               z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function SalaryModal({ salary, branches, users, onClose }: { salary?: any; branches: any[]; users: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: salary ? {
      ...salary,
      branch_id: salary.branch?.id ?? salary.branch_id,
      pay_month: salary.pay_month,
    } : {
      pay_month: new Date().toISOString().slice(0, 7),
      basic_salary: 0, housing_allowance: 0, transport_allowance: 0,
      other_allowances: 0, paye: 0, nssa: 0, other_deductions: 0,
    },
  });

  const basic     = Number(watch('basic_salary') || 0);
  const housing   = Number(watch('housing_allowance') || 0);
  const transport = Number(watch('transport_allowance') || 0);
  const otherAllow= Number(watch('other_allowances') || 0);
  const paye      = Number(watch('paye') || 0);
  const nssa      = Number(watch('nssa') || 0);
  const otherDed  = Number(watch('other_deductions') || 0);
  const gross     = basic + housing + transport + otherAllow;
  const totalDed  = paye + nssa + otherDed;
  const net       = gross - totalDed;

  const mutation = useMutation({
    mutationFn: (d: FormData) => salary ? salariesApi.update(salary.id, d) : salariesApi.create(d),
    onSuccess: () => { toast.success(salary ? 'Updated' : 'Salary record created'); qc.invalidateQueries({ queryKey: ['salaries'] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">{salary ? 'Edit Salary Record' : 'Add Salary Record'}</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-5">
          {/* Employee & Branch */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Branch *</label>
              <select {...register('branch_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select...</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Pay Month *</label>
              <input type="month" {...register('pay_month')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Employee Name *</label>
              <input {...register('employee_name')} list="emp-list" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Type name..." />
              <datalist id="emp-list">{users.map((u: any) => <option key={u.id} value={u.name} />)}</datalist>
              {errors.employee_name && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Position / Role</label>
              <input {...register('position')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Cashier, Manager..." />
            </div>
          </div>

          {/* Earnings */}
          <div className="bg-green-50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-green-800">Earnings</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Basic Salary *</label>
                <input type="number" step="0.01" {...register('basic_salary')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Housing Allowance</label>
                <input type="number" step="0.01" {...register('housing_allowance')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Transport Allowance</label>
                <input type="number" step="0.01" {...register('transport_allowance')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Other Allowances</label>
                <input type="number" step="0.01" {...register('other_allowances')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="pt-2 border-t border-green-200 flex justify-between">
              <span className="text-sm font-semibold text-green-700">Gross Salary</span>
              <span className="text-sm font-bold text-green-700">${gross.toFixed(2)}</span>
            </div>
          </div>

          {/* Deductions */}
          <div className="bg-red-50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-red-800">Deductions</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">PAYE (Tax)</label>
                <input type="number" step="0.01" {...register('paye')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">NSSA</label>
                <input type="number" step="0.01" {...register('nssa')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Other Deductions</label>
                <input type="number" step="0.01" {...register('other_deductions')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="pt-2 border-t border-red-200 flex justify-between">
              <span className="text-sm font-semibold text-red-700">Total Deductions</span>
              <span className="text-sm font-bold text-red-700">${totalDed.toFixed(2)}</span>
            </div>
          </div>

          {/* Net */}
          <div className={`rounded-xl p-4 flex justify-between items-center ${net >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
            <span className="font-bold text-gray-800">Net Salary (Take-Home)</span>
            <span className={`text-2xl font-bold ${net >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>${net.toFixed(2)}</span>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Notes</label>
            <textarea {...register('notes')} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />} {salary ? 'Update' : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MarkPaidModal({ salary, onClose }: { salary: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState('cash');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split('T')[0]);
  const mutation = useMutation({
    mutationFn: () => salariesApi.markPaid(salary.id, { payment_method: method, paid_at: paidAt }),
    onSuccess: () => { toast.success('Marked as paid'); qc.invalidateQueries({ queryKey: ['salaries'] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">Mark as Paid</h2>
          <button type="button" onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <p className="text-sm text-gray-600">Salary for <strong>{salary.employee_name}</strong> — Net ${Number(salary.net_salary).toFixed(2)}</p>
        <div>
          <label className="text-sm font-medium text-gray-700">Payment Method</label>
          <select value={method} onChange={e => setMethod(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="ecocash">EcoCash</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Date Paid</label>
          <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm">Cancel</button>
          <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {mutation.isPending && <Loader2 size={14} className="animate-spin" />} Confirm Paid
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SalariesPage() {
  const [search, setSearch]   = useState('');
  const [payMonth, setPayMonth] = useState(new Date().toISOString().slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modal, setModal]     = useState<{ open: boolean; salary?: any }>({ open: false });
  const [paidModal, setPaidModal] = useState<any>(null);
  const [page, setPage]       = useState(1);
  const qc = useQueryClient();

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []) });
  const { data: userData }   = useQuery({ queryKey: ['users-list'], queryFn: () => usersApi.list({ per_page: 100 }).then(r => r.data?.data?.data || []) });
  const branches = branchData || [];
  const users    = userData || [];

  const params = { search, pay_month: payMonth, branch_id: branchId || undefined, status: filterStatus || undefined, page, per_page: 20 };

  const { data, isLoading } = useQuery({
    queryKey: ['salaries', params],
    queryFn: () => salariesApi.list(params).then(r => r.data?.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => salariesApi.delete(id),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['salaries'] }); },
    onError: () => toast.error('Delete failed'),
  });

  const handleExport = async () => {
    try {
      const res = await salariesApi.exportCsv(params);
      downloadBlob(res.data, `salaries-${payMonth}.csv`);
    } catch { toast.error('Export failed'); }
  };

  const salaries = data?.salaries?.data || [];
  const meta     = data?.salaries?.meta;
  const summary  = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Salaries</h1>
          <p className="text-gray-500 text-sm">Employee payroll — basic, allowances, deductions, net pay</p>
        </div>
        <button type="button" onClick={() => setModal({ open: true })} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm">
          <Plus size={16} /> Add Salary Record
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Gross', value: summary.total_gross, color: 'text-gray-900' },
            { label: 'Total Deductions', value: summary.total_deductions, color: 'text-red-600' },
            { label: 'Total Net', value: summary.total_net, color: 'text-blue-600' },
            { label: 'Outstanding', value: summary.total_pending, color: 'text-orange-600' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">{c.label}</p>
              <p className={`text-xl font-bold ${c.color}`}>${Number(c.value || 0).toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <input type="month" value={payMonth} onChange={e => setPayMonth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All branches</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>
          <button type="button" onClick={handleExport} className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
            <Download size={14} /> Export CSV
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-indigo-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>{['Employee', 'Position', 'Month', 'Basic', 'Allowances', 'Gross', 'Deductions', 'Net Salary', 'Status', ''].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {salaries.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-12 text-gray-400"><Users size={32} className="mx-auto mb-2" /><p>No salary records for {payMonth}</p></td></tr>
                ) : salaries.map((s: any) => {
                  const allowances = Number(s.housing_allowance) + Number(s.transport_allowance) + Number(s.other_allowances);
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.employee_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{s.position || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.pay_month}</td>
                      <td className="px-4 py-3 text-sm text-gray-800">${Number(s.basic_salary).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-green-700">${allowances.toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">${Number(s.gross_salary).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-red-600">-${Number(s.total_deductions).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-blue-700">${Number(s.net_salary).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                          {s.status === 'paid' ? `Paid ${s.paid_at ? format(new Date(s.paid_at), 'dd MMM') : ''}` : 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {s.status === 'pending' && (
                            <button type="button" onClick={() => setPaidModal(s)} title="Mark paid" className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"><CheckCircle size={13} /></button>
                          )}
                          <button type="button" onClick={() => setModal({ open: true, salary: s })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={13} /></button>
                          <button type="button" onClick={() => { if (confirm('Delete record?')) deleteMutation.mutate(s.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>

      {modal.open && <SalaryModal salary={modal.salary} branches={branches} users={users} onClose={() => setModal({ open: false })} />}
      {paidModal && <MarkPaidModal salary={paidModal} onClose={() => setPaidModal(null)} />}
    </div>
  );
}
