import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { suppliersApi } from "../api";
import { Plus, Search, Edit, Trash2, Loader2, X, Store } from "lucide-react";
import Pagination from "../components/ui/Pagination";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";
import { offlineMutate, handleOfflineSuccess } from "../lib/offlineMutation";
import { useCurrencyStore } from "../stores/currencyStore";

const schema = z.object({
  name: z.string().min(1),
  contact_person: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  credit_limit: z.coerce.number().min(0).default(0),
  payment_terms: z.coerce.number().min(0).default(30),
});
type FormData = z.infer<typeof schema>;

function SupplierModal({ supplier, onClose }: { supplier?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { activeCurrency } = useCurrencyStore();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: supplier || { credit_limit: 0, payment_terms: 30 },
  });
  const mutation = useMutation({
    mutationFn: (d: FormData) => supplier
      ? offlineMutate(() => suppliersApi.update(supplier.id, d), 'suppliers', 'update', d as any, supplier.id)
      : offlineMutate(() => suppliersApi.create(d), 'suppliers', 'create', d as any),
    onSuccess: (result, d) => {
      if (result.offline) { handleOfflineSuccess(qc, result, 'suppliers', supplier ? 'update' : 'create', d as any, supplier?.id); toast.success('Saved offline — will sync when server is back'); }
      else { toast.success(supplier ? 'Supplier updated' : 'Supplier created'); qc.invalidateQueries({ queryKey: ['suppliers'] }); }
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-bold">{supplier ? "Edit Supplier" : "New Supplier"}</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div><label className="text-sm font-medium text-gray-700">Supplier Name *</label><input {...register("name")} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />{errors.name && <p className="text-red-500 text-xs mt-1">Required</p>}</div>
          <div><label className="text-sm font-medium text-gray-700">Contact Person</label><input {...register("contact_person")} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Email</label><input type="email" {...register("email")} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
            <div><label className="text-sm font-medium text-gray-700">Phone</label><input {...register("phone")} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          </div>
          <div><label className="text-sm font-medium text-gray-700">Address</label><input {...register("address")} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Credit Limit ({activeCurrency?.symbol ?? '$'})</label><input type="number" step="0.01" {...register("credit_limit")} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
            <div><label className="text-sm font-medium text-gray-700">Payment Terms (days)</label><input type="number" {...register("payment_terms")} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}{supplier ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; supplier?: any }>({ open: false });
  const qc = useQueryClient();
  const { format: formatAmount } = useCurrencyStore();

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", search, page],
    queryFn: () => suppliersApi.list({ search, page, per_page: 20 }).then((r) => r.data?.data),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => offlineMutate(() => suppliersApi.delete(id), 'suppliers', 'delete', {}, id),
    onSuccess: (result, id) => {
      if (result.offline) { handleOfflineSuccess(qc, result, 'suppliers', 'delete', {}, id); toast.success('Deleted offline — will sync when server is back'); }
      else { toast.success('Supplier deleted'); qc.invalidateQueries({ queryKey: ['suppliers'] }); }
    },
  });

  const suppliers = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Suppliers</h1><p className="text-gray-500 text-sm">Manage your suppliers</p></div>
        <button type="button" onClick={() => setModal({ open: true })} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-semibold px-4 py-2.5 rounded-md text-sm"><Plus size={16} /> New Supplier</button>
      </div>
      <div className="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search suppliers..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
        </div>
        {isLoading ? <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-amber-500" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50"><tr>{["Name","Contact","Email","Phone","Balance","Actions"].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {suppliers.length === 0 ? <tr><td colSpan={6} className="text-center py-12 text-gray-400"><Store size={32} className="mx-auto mb-2" /><p>No suppliers found</p></td></tr>
                  : suppliers.map((s: any) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.contact_person || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.email || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.phone || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatAmount(parseFloat(s.balance || 0))}</td>
                      <td className="px-4 py-3"><div className="flex gap-2"><button type="button" onClick={() => setModal({ open: true, supplier: s })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={14} /></button><button type="button" onClick={() => { if (confirm(`Delete ${s.name}?`)) deleteMutation.mutate(s.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button></div></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
      </div>
      {modal.open && <SupplierModal supplier={modal.supplier} onClose={() => setModal({ open: false })} />}
    </div>
  );
}
