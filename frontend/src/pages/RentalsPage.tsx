import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rentalsApi, branchesApi } from '../api';
import { Plus, Search, Download, Loader2, X, Building2, Edit, Trash2, CreditCard } from 'lucide-react';
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

const rentalSchema = z.object({
  branch_id:      z.coerce.number().min(1),
  property_name:  z.string().min(1),
  property_type:  z.enum(['commercial', 'residential', 'storage']).default('commercial'),
  tenant_name:    z.string().min(1),
  tenant_phone:   z.string().optional(),
  tenant_email:   z.string().email().optional().or(z.literal('')),
  monthly_amount: z.coerce.number().min(0.01),
  currency:       z.string().default('USD'),
  lease_start:    z.string().min(1),
  lease_end:      z.string().optional(),
  flow_type:      z.enum(['income', 'expense']),
  status:         z.enum(['active', 'expired', 'terminated']).default('active'),
  notes:          z.string().optional(),
});
type RentalFormData = z.infer<typeof rentalSchema>;

const paymentSchema = z.object({
  period:         z.string().regex(/^\d{4}-\d{2}$/, 'Format: YYYY-MM'),
  amount:         z.coerce.number().min(0.01),
  payment_date:   z.string().min(1),
  payment_method: z.string().default('cash'),
  notes:          z.string().optional(),
});
type PaymentFormData = z.infer<typeof paymentSchema>;

function RentalModal({ rental, branches, onClose }: { rental?: any; branches: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<RentalFormData>({
    resolver: zodResolver(rentalSchema) as any,
    defaultValues: rental ? {
      ...rental, branch_id: rental.branch?.id ?? rental.branch_id,
      lease_start: rental.lease_start?.split('T')[0] ?? rental.lease_start,
      lease_end: rental.lease_end?.split('T')[0] ?? rental.lease_end,
    } : { flow_type: 'income', property_type: 'commercial', currency: 'USD', status: 'active', lease_start: new Date().toISOString().split('T')[0] },
  });

  const mutation = useMutation({
    mutationFn: (d: RentalFormData) => rental ? rentalsApi.update(rental.id, d) : rentalsApi.create(d),
    onSuccess: () => { toast.success(rental ? 'Updated' : 'Rental created'); qc.invalidateQueries({ queryKey: ['rentals'] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-bold">{rental ? 'Edit Rental' : 'Add Rental Property'}</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit((d: RentalFormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Branch *</label>
              <select {...register('branch_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="">Select...</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Flow Type *</label>
              <select {...register('flow_type')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="income">Income (We collect rent)</option>
                <option value="expense">Expense (We pay rent)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Property Name *</label>
              <input {...register('property_name')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="Shop A, Warehouse 1..." />
              {errors.property_name && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Property Type</label>
              <select {...register('property_type')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="commercial">Commercial</option>
                <option value="residential">Residential</option>
                <option value="storage">Storage</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Tenant / Landlord Name *</label>
              <input {...register('tenant_name')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              {errors.tenant_name && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <input {...register('tenant_phone')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Monthly Amount *</label>
              <input type="number" step="0.01" {...register('monthly_amount')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Currency</label>
              <select {...register('currency')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="USD">USD</option><option value="ZWL">ZWL</option><option value="ZAR">ZAR</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Status</label>
              <select {...register('status')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Lease Start *</label>
              <input type="date" {...register('lease_start')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Lease End</label>
              <input type="date" {...register('lease_end')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Notes</label>
            <textarea {...register('notes')} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-md text-sm hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />} {rental ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PaymentModal({ rental, onClose }: { rental: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema) as any,
    defaultValues: {
      period: new Date().toISOString().slice(0, 7),
      payment_date: new Date().toISOString().split('T')[0],
      amount: rental.monthly_amount,
      payment_method: 'cash',
    },
  });
  const mutation = useMutation({
    mutationFn: (d: PaymentFormData) => rentalsApi.addPayment(rental.id, d),
    onSuccess: () => { toast.success('Payment recorded'); qc.invalidateQueries({ queryKey: ['rentals'] }); qc.invalidateQueries({ queryKey: ['rental-payments', rental.id] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const { data: pmtData } = useQuery({
    queryKey: ['rental-payments', rental.id],
    queryFn: () => rentalsApi.payments(rental.id).then(r => r.data?.data?.data || []),
  });
  const payments = pmtData || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold">Record Payment</h2>
            <p className="text-sm text-gray-500">{rental.property_name} - {rental.tenant_name}</p>
          </div>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="p-6 space-y-5">
          <form onSubmit={handleSubmit((d: PaymentFormData) => mutation.mutate(d))} className="space-y-4 pb-4 border-b border-gray-100">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Rent Period *</label>
                <input type="month" {...register('period')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                {errors.period && <p className="text-red-500 text-xs mt-1">{errors.period.message}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Amount *</label>
                <input type="number" step="0.01" {...register('amount')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Payment Date *</label>
                <input type="date" {...register('payment_date')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Method</label>
                <select {...register('payment_method')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="ecocash">EcoCash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-md text-sm">Cancel</button>
              <button type="submit" disabled={mutation.isPending} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {mutation.isPending && <Loader2 size={14} className="animate-spin" />} Record Payment
              </button>
            </div>
          </form>

          {/* Payment history */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Payment History</h3>
            {payments.length === 0 ? <p className="text-gray-400 text-sm">No payments recorded yet</p> : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {payments.map((p: any) => (
                  <div key={p.id} className="flex justify-between items-center text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="font-medium text-gray-800">{p.period}</span>
                      <span className="text-gray-400 ml-2">Ã‚Â· {format(new Date(p.payment_date), 'dd MMM yyyy')}</span>
                    </div>
                    <span className="font-semibold text-green-700">${Number(p.amount).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RentalsPage() {
  const [search, setSearch]     = useState('');
  const [filterFlow, setFilterFlow] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [branchId, setBranchId] = useState('');
  const [modal, setModal]       = useState<{ open: boolean; rental?: any }>({ open: false });
  const [payModal, setPayModal] = useState<any>(null);
  const [page, setPage]         = useState(1);
  const qc = useQueryClient();

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list().then(r => r.data?.data || []) });
  const branches = branchData || [];

  const params = { search, flow_type: filterFlow || undefined, status: filterStatus || undefined, branch_id: branchId || undefined, page, per_page: 20 };

  const { data, isLoading } = useQuery({
    queryKey: ['rentals', params],
    queryFn: () => rentalsApi.list(params).then(r => r.data?.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => rentalsApi.delete(id),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['rentals'] }); },
    onError: () => toast.error('Delete failed'),
  });

  const handleExport = async () => {
    try {
      const res = await rentalsApi.exportCsv(params);
      downloadBlob(res.data, 'rentals.csv');
    } catch { toast.error('Export failed'); }
  };

  const rentals = data?.rentals?.data || data?.data || [];
  const meta    = data?.rentals?.meta ?? (data?.last_page ? { current_page: data.current_page, last_page: data.last_page, from: data.from, to: data.to, total: data.total } : null);
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rentals</h1>
          <p className="text-gray-500 text-sm">Property rentals - income (collect) and expenses (pay)</p>
        </div>
        <button type="button" onClick={() => setModal({ open: true })} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm">
          <Plus size={16} /> Add Rental
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-md border border-gray-100 p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Monthly Rental Income</p>
            <p className="text-xl font-bold text-green-600">${Number(summary.total_income_monthly || 0).toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-md border border-gray-100 p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Monthly Rental Expense</p>
            <p className="text-xl font-bold text-red-600">${Number(summary.total_expense_monthly || 0).toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-md border border-gray-100 p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">Active Properties</p>
            <p className="text-xl font-bold text-gray-900">{summary.active_count}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search property, tenant..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <select value={filterFlow} onChange={e => setFilterFlow(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="terminated">Terminated</option>
          </select>
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">All branches</option>
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="button" onClick={handleExport} className="flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
            <Download size={14} /> Export CSV
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-purple-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>{['Property', 'Type', 'Tenant / Landlord', 'Phone', 'Monthly', 'Lease Period', 'Total Paid', 'Status', ''].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rentals.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400"><Building2 size={32} className="mx-auto mb-2" /><p>No rental records</p></td></tr>
                ) : rentals.map((r: any) => {
                  const totalPaid = (r.payments || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.property_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 capitalize">{r.property_type}</td>
                      <td className="px-4 py-3 text-sm text-gray-800">{r.tenant_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{r.tenant_phone || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-semibold ${r.flow_type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                          {r.flow_type === 'income' ? '+' : '-'}${Number(r.monthly_amount).toFixed(2)} <span className="text-gray-400 font-normal text-xs">{r.currency}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.lease_start ? format(new Date(r.lease_start), 'MMM yyyy') : '-'}
                        {r.lease_end ? ` to ${format(new Date(r.lease_end), "MMM yyyy")}` : "Open"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">${totalPaid.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'active' ? 'bg-green-100 text-green-700' : r.status === 'expired' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setPayModal(r)} title="Record payment" className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg"><CreditCard size={13} /></button>
                          <button type="button" onClick={() => setModal({ open: true, rental: r })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={13} /></button>
                          <button type="button" onClick={() => { if (confirm('Delete rental?')) deleteMutation.mutate(r.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
          </div>
        )}
      </div>

      {modal.open && <RentalModal rental={modal.rental} branches={branches} onClose={() => setModal({ open: false })} />}
      {payModal && <PaymentModal rental={payModal} onClose={() => setPayModal(null)} />}
    </div>
  );
}
