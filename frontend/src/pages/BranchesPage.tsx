import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { branchesApi } from '../api';
import { Plus, Edit, Trash2, Loader2, X, Building2, MapPin, Phone, Mail } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';

const schema = z.object({
  name:     z.string().min(1, 'Branch name is required'),
  address:  z.string().optional(),
  city:     z.string().optional(),
  phone:    z.string().optional(),
  email:    z.string().email().optional().or(z.literal('')),
  currency: z.string().length(3).optional().or(z.literal('')),
  is_active: z.boolean().default(true),
});
type FormData = z.infer<typeof schema>;

function BranchModal({ branch, onClose }: { branch?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const field = 'mt-1 w-full border border-gray-200 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: branch
      ? { ...branch, is_active: branch.is_active ?? true }
      : { is_active: true, currency: 'ZAR' },
  });

  const mutation = useMutation({
    mutationFn: (d: FormData) => {
      const payload = { ...d, currency: d.currency || undefined, email: d.email || undefined };
      return branch ? branchesApi.update(branch.id, payload) : branchesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(branch ? 'Branch updated' : 'Branch created');
      qc.invalidateQueries({ queryKey: ['branches'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving branch'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{branch ? 'Edit Branch' : 'Add New Branch'}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-semibold text-gray-700">Branch Name *</label>
            <input {...register('name')} className={field} placeholder="e.g. Main Branch" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700">City</label>
              <input {...register('city')} className={field} placeholder="e.g. Harare" />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Currency</label>
              <input {...register('currency')} className={field} placeholder="ZAR" maxLength={3} />
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700">Address</label>
            <input {...register('address')} className={field} placeholder="e.g. 123 Main Street" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700">Phone</label>
              <input {...register('phone')} className={field} placeholder="+263..." />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Email</label>
              <input type="email" {...register('email')} className={field} placeholder="branch@..." />
              {errors.email && <p className="text-red-500 text-xs mt-1">Invalid email</p>}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('is_active')} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4" />
            <span className="text-sm font-medium text-gray-700">Active</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
              {branch ? 'Update Branch' : 'Add Branch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BranchesPage() {
  const [modal, setModal] = useState<{ open: boolean; branch?: any }>({ open: false });
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list().then(r => r.data?.data || []),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => branchesApi.delete(id),
    onSuccess: () => { toast.success('Branch removed'); qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Cannot remove this branch'),
  });

  const branches: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Branches</h1>
          <p className="text-gray-400 text-sm mt-0.5">{branches.length} branch{branches.length !== 1 ? 'es' : ''}</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ open: true })}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm shadow-md shadow-blue-100 transition-colors"
        >
          <Plus size={16} /> Add Branch
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-blue-500" /></div>
      ) : branches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Building2 size={48} className="text-gray-200 mb-3" />
          <p className="font-medium">No branches found</p>
          <p className="text-sm mt-1">Add your first branch to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map((b: any) => (
            <div key={b.id} className="bg-white rounded-lg border border-gray-100 shadow-sm p-5 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-12 bg-blue-50 rounded-md flex items-center justify-center">
                  <Building2 size={22} className="text-blue-600" />
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${b.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {b.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="mb-3">
                <p className="font-bold text-gray-900">{b.name}</p>
                {b.is_main && <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">Main</span>}
              </div>

              <div className="space-y-1.5 text-xs text-gray-500">
                {(b.address || b.city) && (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={12} className="text-gray-400 flex-shrink-0" />
                    <span>{[b.address, b.city].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {b.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone size={12} className="text-gray-400 flex-shrink-0" />
                    <span>{b.phone}</span>
                  </div>
                )}
                {b.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail size={12} className="text-gray-400 flex-shrink-0" />
                    <span>{b.email}</span>
                  </div>
                )}
                {b.currency && (
                  <div className="text-gray-400">Currency: <span className="font-semibold text-gray-600">{b.currency}</span></div>
                )}
              </div>

              <div className="flex items-center justify-end gap-1 pt-3 mt-3 border-t border-gray-50">
                <button type="button" onClick={() => setModal({ open: true, branch: b })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <Edit size={14} />
                </button>
                {!b.is_main && (
                  <button type="button" onClick={() => { if (confirm(`Remove branch "${b.name}"?`)) deleteMutation.mutate(b.id); }} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && <BranchModal branch={modal.branch} onClose={() => setModal({ open: false })} />}
    </div>
  );
}
