import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { expensesApi } from '../api';
import { Plus, Search, Edit, Trash2, Loader2, X, CreditCard } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const schema = z.object({
  title: z.string().min(1),
  amount: z.coerce.number().min(0),
  expense_category_id: z.coerce.number().optional(),
  expense_date: z.string().min(1),
  payment_method: z.string().default('cash'),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function ExpenseModal({ expense, categories, onClose }: { expense?: any; categories: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: expense || { expense_date: new Date().toISOString().split('T')[0], payment_method: 'cash' },
  });
  const mutation = useMutation({
    mutationFn: (d: FormData) => expense ? expensesApi.update(expense.id, d) : expensesApi.create(d),
    onSuccess: () => { toast.success(expense ? 'Expense updated' : 'Expense recorded'); qc.invalidateQueries({ queryKey: ['expenses'] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold">{expense ? 'Edit Expense' : 'Record Expense'}</h2><button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button></div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div><label className="text-sm font-medium text-gray-700">Title *</label><input {...register('title')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />{errors.title && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Amount (R) *</label><input type="number" step="0.01" {...register('amount')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />{errors.amount && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
            <div><label className="text-sm font-medium text-gray-700">Date *</label><input type="date" {...register('expense_date')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Category</label><select {...register('expense_category_id')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"><option value="">Select...</option>{categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-sm font-medium text-gray-700">Payment Method</label><select {...register('payment_method')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"><option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option><option value="card">Card</option></select></div>
          </div>
          <div><label className="text-sm font-medium text-gray-700">Notes</label><textarea {...register('notes')} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}{expense ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ExpensesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; expense?: any }>({ open: false });
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['expenses', search, page], queryFn: () => expensesApi.list({ search, page, per_page: 20 }).then(r => r.data?.data) });
  const { data: catData } = useQuery({ queryKey: ['expense-categories'], queryFn: () => expensesApi.categories().then(r => r.data?.data || []) });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => expensesApi.delete(id),
    onSuccess: () => { toast.success('Expense deleted'); qc.invalidateQueries({ queryKey: ['expenses'] }); },
  });

  const expenses = data?.data || [];
  const meta = data?.meta;
  const categories = catData || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Expenses</h1><p className="text-gray-500 text-sm">Track business expenses</p></div>
        <button type="button" onClick={() => setModal({ open: true })} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-4 py-2.5 rounded-xl text-sm"><Plus size={16} /> Record Expense</button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100"><div className="relative max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search expenses..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div></div>
        {isLoading ? <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50"><tr>{['Reference', 'Title', 'Date', 'Category', 'Amount', 'Payment', 'Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.length === 0 ? <tr><td colSpan={7} className="text-center py-12 text-gray-400"><CreditCard size={32} className="mx-auto mb-2" /><p>No expenses recorded</p></td></tr>
                  : expenses.map((e: any) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{e.reference}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{e.title}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{format(new Date(e.expense_date), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{e.category?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600">R {parseFloat(e.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 capitalize">{e.payment_method?.replace('_', ' ')}</td>
                      <td className="px-4 py-3"><div className="flex gap-2"><button type="button" onClick={() => setModal({ open: true, expense: e })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={14} /></button><button type="button" onClick={() => { if (confirm('Delete this expense?')) deleteMutation.mutate(e.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button></div></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {meta && meta.last_page > 1 && <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100"><p className="text-sm text-gray-500">Showing {meta.from}–{meta.to} of {meta.total}</p><div className="flex gap-2"><button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">Prev</button><button type="button" disabled={page === meta.last_page} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">Next</button></div></div>}
      </div>
      {modal.open && <ExpenseModal expense={modal.expense} categories={categories} onClose={() => setModal({ open: false })} />}
    </div>
  );
}
