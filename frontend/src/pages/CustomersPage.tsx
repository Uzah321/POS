import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../api';
import { Plus, Search, Edit, Trash2, Users, Loader2, X, WifiOff, Gift, Minus } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { db, type LocalCustomer } from '../lib/db';
import { useOfflineStore } from '../stores/offlineStore';
import { useCurrencyStore } from '../stores/currencyStore';

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  credit_limit: z.coerce.number().min(0).default(0),
});
type FormData = z.infer<typeof schema>;

function makeMutId() {
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CustomerModal({ customer, onClose }: { customer?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: customer || {},
  });

  const mutation = useMutation({
    mutationFn: async (d: FormData) => {
      try {
        const r = customer
          ? await customersApi.update(customer.id, d)
          : await customersApi.create(d);
        const saved = r.data?.data ?? r.data;
        if (saved?.id) await db.customers.put(saved as LocalCustomer);
        return { offline: false };
      } catch {
        if (customer) {
          await db.customers.put({ ...customer, ...d } as LocalCustomer);
          await db.pendingMutations.add({
            id: makeMutId(), resource: 'customers', action: 'update',
            resourceId: customer.id, payload: d as any, queuedAt: Date.now(), attempts: 0,
          });
        } else {
          const tempId = -(Date.now());
          await db.customers.put({ id: tempId, ...d } as LocalCustomer);
          await db.pendingMutations.add({
            id: makeMutId(), resource: 'customers', action: 'create',
            resourceId: tempId, payload: d as any, queuedAt: Date.now(), attempts: 0,
          });
        }
        return { offline: true };
      }
    },
    onSuccess: (result) => {
      if (result.offline) {
        toast.success(customer ? 'Customer saved offline — will sync when server is back' : 'Customer added offline — will sync when server is back');
      } else {
        toast.success(customer ? 'Customer updated' : 'Customer created');
      }
      qc.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
    onError: () => toast.error('Failed to save customer'),
  });

  const field = 'mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-lg font-bold">{customer ? 'Edit Customer' : 'New Customer'}</h2>
            {!isOnline && (
              <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                <WifiOff size={11} /> Offline — will sync when server reconnects
              </p>
            )}
          </div>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Full Name *</label>
            <input {...register('name')} className={field} />
            {errors.name && <p className="text-red-500 text-xs mt-1">Required</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Email</label>
              <input type="email" {...register('email')} className={field} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <input {...register('phone')} className={field} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Address</label>
            <input {...register('address')} className={field} />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Credit Limit</label>
            <input type="number" step="0.01" {...register('credit_limit')} className={field} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
              {customer ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const LOYALTY_TYPE_STYLE: Record<string, string> = {
  earned: 'bg-emerald-50 text-emerald-700',
  redeemed: 'bg-amber-50 text-amber-700',
  adjusted: 'bg-blue-50 text-blue-700',
  expired: 'bg-gray-100 text-gray-500',
};

function LoyaltyModal({ customer, onClose }: { customer: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [redeemPoints, setRedeemPoints] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customer-loyalty', customer.id],
    queryFn: () => customersApi.getLoyalty(customer.id).then(r => r.data?.data),
  });

  const balance = data?.balance ?? customer.loyalty_points ?? 0;
  const transactions: any[] = data?.transactions ?? [];

  const redeemMutation = useMutation({
    mutationFn: (points: number) => customersApi.redeemLoyalty(customer.id, points),
    onSuccess: () => {
      toast.success('Points redeemed');
      setRedeemPoints('');
      qc.invalidateQueries({ queryKey: ['customer-loyalty', customer.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Failed to redeem points — check the local server is reachable'),
  });

  const handleRedeem = () => {
    const n = parseInt(redeemPoints, 10);
    if (!n || n <= 0) { toast.error('Enter a number of points to redeem'); return; }
    if (n > balance) { toast.error('Not enough points'); return; }
    redeemMutation.mutate(n);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><Gift size={18} className="text-amber-500" /> Loyalty — {customer.name}</h2>
            <p className="text-sm text-gray-400 mt-0.5">Current balance: <span className="font-semibold text-amber-600">{balance} pts</span></p>
          </div>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="p-6 border-b flex-shrink-0 space-y-3">
          <label className="text-sm font-medium text-gray-700">Redeem points</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={balance}
              value={redeemPoints}
              onChange={(e) => setRedeemPoints(e.target.value)}
              placeholder="Points to redeem"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              type="button"
              onClick={handleRedeem}
              disabled={redeemMutation.isPending || balance === 0}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-50"
            >
              {redeemMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />}
              Redeem
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">History</p>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-amber-500" /></div>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">No loyalty activity yet</p>
          ) : (
            <div className="space-y-2">
              {transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                  <div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${LOYALTY_TYPE_STYLE[t.type] ?? 'bg-gray-100 text-gray-500'}`}>{t.type}</span>
                    {t.note && <span className="text-xs text-gray-400 ml-2">{t.note}</span>}
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(t.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                  <span className={`font-semibold ${t.type === 'earned' ? 'text-emerald-600' : t.type === 'redeemed' ? 'text-amber-600' : 'text-gray-600'}`}>
                    {t.type === 'redeemed' ? '-' : '+'}{t.points} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; customer?: any }>({ open: false });
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<any>(null);
  const qc = useQueryClient();
  const { format: formatAmount } = useCurrencyStore();

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: async () => {
      try {
        const r = await customersApi.list({ search, page, per_page: 20 });
        const customers: LocalCustomer[] = r.data?.data?.data ?? r.data?.data ?? [];
        if (customers.length > 0) await db.customers.bulkPut(customers);
        return r.data?.data;
      } catch {
        let cached = await db.customers.toArray();
        if (search) {
          const q = search.toLowerCase();
          cached = cached.filter(c =>
            c.name?.toLowerCase().includes(q) ||
            c.phone?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q)
          );
        }
        const total = cached.length;
        const perPage = 20;
        const from = (page - 1) * perPage;
        const pageData = cached.slice(from, from + perPage);
        return {
          data: pageData,
          meta: { last_page: Math.ceil(total / perPage) || 1, from: total === 0 ? 0 : from + 1, to: from + pageData.length, total },
        };
      }
    },
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      try {
        await customersApi.delete(id);
        await db.customers.delete(id);
        return { offline: false };
      } catch {
        if (id < 0) {
          await db.customers.delete(id);
          await db.pendingMutations.where('resource').equals('customers').filter(m => m.resourceId === id).delete();
          return { offline: false };
        }
        await db.customers.delete(id);
        await db.pendingMutations.add({
          id: makeMutId(), resource: 'customers', action: 'delete',
          resourceId: id, payload: {}, queuedAt: Date.now(), attempts: 0,
        });
        return { offline: true };
      }
    },
    onSuccess: (result) => {
      toast.success(result.offline ? 'Customer removed locally — will sync when server is back' : 'Customer deleted');
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: () => toast.error('Failed to delete customer'),
  });

  const customers = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 text-sm">Manage your customer base</p>
        </div>
        <button type="button" onClick={() => setModal({ open: true })} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-4 py-2.5 rounded-md text-sm">
          <Plus size={16} /> New Customer
        </button>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search customers..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>{['Name', 'Email', 'Phone', 'Loyalty Points', 'Balance', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customers.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400"><Users size={32} className="mx-auto mb-2" /><p>No customers found</p></td></tr>
                ) : customers.map((c: any) => (
                  <tr key={c.id} className={`hover:bg-gray-50 ${c.id < 0 ? 'bg-amber-50' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {c.name}
                      {c.id < 0 && <span className="ml-2 text-xs text-amber-600 inline-flex items-center gap-0.5"><WifiOff size={9} /> pending</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.email || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        type="button"
                        onClick={() => setLoyaltyCustomer(c)}
                        className="flex items-center gap-1 text-amber-600 font-medium hover:text-amber-700 hover:underline"
                        title="View loyalty history / redeem points"
                      >
                        <Gift size={12} /> {c.loyalty_points || 0} pts
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatAmount(parseFloat(c.balance || 0))}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setModal({ open: true, customer: c })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={14} /></button>
                        <button type="button" onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteMutation.mutate(c.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
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

      {modal.open && <CustomerModal customer={modal.customer} onClose={() => setModal({ open: false })} />}
      {loyaltyCustomer && <LoyaltyModal customer={loyaltyCustomer} onClose={() => setLoyaltyCustomer(null)} />}
    </div>
  );
}
