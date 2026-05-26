import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, branchesApi } from '../api';
import { Plus, Search, Edit, Trash2, Loader2, X, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';

const ROLES = ['admin', 'manager', 'cashier', 'storekeeper', 'accountant'];

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  cashier: 'bg-emerald-100 text-emerald-700',
  storekeeper: 'bg-purple-100 text-purple-700',
  accountant: 'bg-yellow-100 text-yellow-700',
};

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500',
];

const SHIFTS = ['08:00 – 16:00', '09:00 – 17:00', '12:00 – 20:00', '16:00 – 00:00', '07:00 – 15:00'];

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).optional().or(z.literal('')),
  role: z.string().min(1),
  branch_id: z.coerce.number().optional(),
  is_active: z.boolean().default(true),
});
type FormData = z.infer<typeof schema>;

function UserModal({ user, branches, onClose }: { user?: any; branches: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: user ? { ...user, role: user.roles?.[0], password: '', branch_id: user.branch?.id } : { is_active: true },
  });
  const mutation = useMutation({
    mutationFn: (d: FormData) => {
      const payload: any = { ...d, roles: [d.role] };
      if (!payload.password) delete payload.password;
      return user ? usersApi.update(user.id, payload) : usersApi.create(payload);
    },
    onSuccess: () => { toast.success(user ? 'Staff updated' : 'Staff member added'); qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const field = 'mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{user ? 'Edit Staff Member' : 'Add Staff Member'}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-semibold text-gray-700">Full Name *</label>
            <input {...register('name')} className={field} />
            {errors.name && <p className="text-red-500 text-xs mt-1">Required</p>}
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700">Email *</label>
            <input type="email" {...register('email')} className={field} />
            {errors.email && <p className="text-red-500 text-xs mt-1">Valid email required</p>}
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700">{user ? 'New Password (leave blank to keep)' : 'Password *'}</label>
            <input type="password" {...register('password')} className={field} />
            {errors.password && <p className="text-red-500 text-xs mt-1">Min 8 characters</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700">Role *</label>
              <select {...register('role')} className={field}>
                <option value="">Select role...</option>
                {ROLES.map(r => <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
              {errors.role && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Branch</label>
              <select {...register('branch_id')} className={field}>
                <option value="">Select branch...</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="is_active" {...register('is_active')} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4" />
            <span className="text-sm font-medium text-gray-700">Active</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
              {user ? 'Update' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StaffCard({ user, onEdit, onDelete }: { user: any; onEdit: () => void; onDelete: () => void }) {
  const initials = user.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
  const avatarColor = AVATAR_COLORS[user.id % AVATAR_COLORS.length];
  const role = user.roles?.[0] ?? 'user';
  const shift = SHIFTS[user.id % SHIFTS.length];
  const isActive = user.is_active;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-14 h-14 rounded-2xl ${avatarColor} flex items-center justify-center text-white font-bold text-lg shadow-sm`}>
          {initials}
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="mb-3">
        <p className="font-bold text-gray-900">{user.name}</p>
        <p className="text-sm text-gray-400">{user.email}</p>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600'}`}>
          {role}
        </span>
        {user.branch?.name && (
          <span className="text-xs text-gray-400">{user.branch.name}</span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-gray-50">
        <span>Shift: <span className="text-gray-600 font-medium">{shift}</span></span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
            <Edit size={13} />
          </button>
          <button type="button" onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; user?: any }>({ open: false });
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['users', search, page],
    queryFn: () => usersApi.list({ search, page, per_page: 20 }).then(r => r.data?.data),
  });

  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list().then(r => r.data?.data || []),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => { toast.success('Staff removed'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: () => toast.error('Cannot remove this staff member'),
  });

  const users: any[] = data?.data || [];
  const meta = data?.meta;
  const branches: any[] = Array.isArray(branchesData) ? branchesData : [];

  const activeCount = users.filter(u => u.is_active).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {users.length} total · <span className="text-emerald-600 font-medium">{activeCount} active</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ open: true })}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm shadow-md shadow-blue-100 transition-colors"
        >
          <Plus size={16} /> Add Employee
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search staff..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
        />
      </div>

      {/* Staff grid */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Users size={48} className="text-gray-200 mb-3" />
          <p className="font-medium">No staff found</p>
          <p className="text-sm mt-1">Add your first team member</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {users.map((u: any) => (
            <StaffCard
              key={u.id}
              user={u}
              onEdit={() => setModal({ open: true, user: u })}
              onDelete={() => { if (confirm(`Remove ${u.name} from staff?`)) deleteMutation.mutate(u.id); }}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.last_page > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-gray-500">Showing {meta.from}–{meta.to} of {meta.total}</p>
          <div className="flex gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 bg-white">Prev</button>
            <button type="button" disabled={page === meta.last_page} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 bg-white">Next</button>
          </div>
        </div>
      )}

      {modal.open && <UserModal user={modal.user} branches={branches} onClose={() => setModal({ open: false })} />}
    </div>
  );
}
