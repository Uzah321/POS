import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, branchesApi, departmentsApi } from '../api';
import { Plus, Search, Edit, Trash2, Loader2, X, Users, WifiOff, Building2 } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { db, type LocalUser } from '../lib/db';
import { useOfflineStore } from '../stores/offlineStore';

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
  username: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, _ and - allowed'),
  email: z.string().email().optional().or(z.literal('')),
  password: z.string().min(4).optional().or(z.literal('')),
  role: z.string().min(1),
  branch_id: z.preprocess(v => (v === '' || v === '0' || v === 0) ? undefined : Number(v), z.number().optional()),
  department_id: z.preprocess(v => (v === '' || v === '0' || v === 0) ? undefined : Number(v), z.number().optional()),
  is_active: z.boolean().default(true),
});
type FormData = z.infer<typeof schema>;

function makeMutId() {
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function UserModal({ user, branches, departments, onClose }: { user?: any; branches: any[]; departments: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: user
      ? { ...user, role: user.roles?.[0]?.name ?? user.roles?.[0], password: '', branch_id: user.branch?.id, department_id: user.department?.id }
      : { is_active: true },
  });

  const mutation = useMutation({
    mutationFn: async (d: FormData) => {
      const payload: any = { ...d, roles: [d.role] };
      if (!payload.password) delete payload.password;

      // Try the server first; fall back to IndexedDB when unavailable
      try {
        const r = user
          ? await usersApi.update(user.id, payload)
          : await usersApi.create(payload);
        const saved = r.data?.data ?? r.data;
        if (saved?.id) await db.users.put(saved as LocalUser);
        return { offline: false };
      } catch {
        // Server unavailable — persist locally and queue for sync
        if (user) {
          const updated: LocalUser = {
            ...user,
            ...payload,
            roles: [{ name: d.role }],
          };
          await db.users.put(updated);
          await db.pendingMutations.add({
            id: makeMutId(),
            resource: 'users',
            action: 'update',
            resourceId: user.id,
            payload,
            queuedAt: Date.now(),
            attempts: 0,
          });
        } else {
          const tempId = -(Date.now());
          const tempUser: LocalUser = {
            id: tempId,
            name: d.name,
            username: d.username,
            email: d.email || undefined,
            roles: [{ name: d.role }],
            branch_id: d.branch_id ?? null,
            department_id: d.department_id ?? null,
            is_active: d.is_active,
          };
          await db.users.put(tempUser);
          await db.pendingMutations.add({
            id: makeMutId(),
            resource: 'users',
            action: 'create',
            resourceId: tempId,
            payload,
            queuedAt: Date.now(),
            attempts: 0,
          });
        }
        return { offline: true };
      }
    },
    onSuccess: (result) => {
      if (result.offline) {
        toast.success(user ? 'Changes saved offline — will sync when server is back' : 'Staff added offline — will sync when server is back');
      } else {
        toast.success(user ? 'Staff updated' : 'Staff member added');
      }
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: () => toast.error('Failed to save'),
  });

  const field = 'mt-1 w-full border border-gray-200 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{user ? 'Edit Staff Member' : 'Add Staff Member'}</h2>
            {!isOnline && (
              <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                <WifiOff size={11} /> Offline — will sync when server reconnects
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit((d: FormData) => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-semibold text-gray-700">Full Name *</label>
            <input {...register('name')} className={field} placeholder="e.g. John Doe" />
            {errors.name && <p className="text-red-500 text-xs mt-1">Required</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700">Username *</label>
              <input {...register('username')} className={field} placeholder="e.g. john_doe" />
              {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username.message || 'Required'}</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{user ? 'New Password' : 'Password *'}</label>
              <input type="password" {...register('password')} className={field} placeholder={user ? 'Leave blank to keep' : 'Min 4 chars'} />
              {errors.password && <p className="text-red-500 text-xs mt-1">Min 4 characters</p>}
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700">Email <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="email" {...register('email')} className={field} placeholder="e.g. john@example.com" />
            {errors.email && <p className="text-red-500 text-xs mt-1">Valid email required</p>}
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
          <div>
            <label className="text-sm font-semibold text-gray-700">Department</label>
            <select {...register('department_id')} className={field}>
              <option value="">Select department...</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="is_active" {...register('is_active')} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4" />
            <span className="text-sm font-medium text-gray-700">Active</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-60">
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
  const absId = Math.abs(user.id ?? 0);
  const avatarColor = AVATAR_COLORS[absId % AVATAR_COLORS.length];
  const role: string = user.roles?.[0]?.name ?? user.roles?.[0] ?? 'user';
  const shift = SHIFTS[absId % SHIFTS.length];
  const isActive = user.is_active;
  const isPending = user.id < 0;

  return (
    <div className={`bg-white rounded-lg border shadow-sm p-5 hover:shadow-md transition-all ${isPending ? 'border-amber-200' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-14 h-14 rounded-lg ${avatarColor} flex items-center justify-center text-white font-bold text-lg shadow-sm`}>
          {initials}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
          {isPending && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
              <WifiOff size={9} /> Pending sync
            </span>
          )}
        </div>
      </div>

      <div className="mb-3">
        <p className="font-bold text-gray-900">{user.name}</p>
        <p className="text-sm text-gray-500 font-mono">@{user.username}</p>
        {user.email && <p className="text-xs text-gray-400">{user.email}</p>}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600'}`}>
          {role}
        </span>
        {user.branch?.name && (
          <span className="text-xs text-gray-400">{user.branch.name}</span>
        )}
        {user.department?.name && (
          <span className="text-xs text-gray-400">· {user.department.name}</span>
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

function DepartmentsModal({ departments, onClose }: { departments: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const createMut = useMutation({
    mutationFn: (name: string) => departmentsApi.create({ name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setAdding(false);
      setNameInput('');
      toast.success('Department created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create department'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => departmentsApi.update(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setEditing(null);
      toast.success('Department updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update department'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => departmentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department deleted');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Cannot delete — department may be in use'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Departments</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
          {adding && (
            <div className="flex items-center gap-2 p-2 border border-blue-100 bg-blue-50 rounded-md">
              <input
                autoFocus
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && nameInput.trim()) createMut.mutate(nameInput.trim());
                  if (e.key === 'Escape') { setAdding(false); setNameInput(''); }
                }}
                placeholder="Department name..."
                className="flex-1 border border-blue-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <button
                type="button"
                disabled={!nameInput.trim() || createMut.isPending}
                onClick={() => createMut.mutate(nameInput.trim())}
                className="px-3 py-2 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {createMut.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
              </button>
              <button type="button" onClick={() => { setAdding(false); setNameInput(''); }} className="p-2 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50">
                <X size={12} />
              </button>
            </div>
          )}

          {!departments.length && !adding ? (
            <div className="text-center py-10 text-gray-400">
              <Building2 size={32} className="mx-auto mb-2 text-gray-200" />
              <p className="text-sm font-medium">No departments yet</p>
            </div>
          ) : (
            departments.map(dep => {
              const current = editing && editing.id === dep.id ? editing : null;
              return (
              <div key={dep.id} className="flex items-center justify-between gap-2 p-2 rounded-md hover:bg-gray-50">
                {current ? (
                  <input
                    autoFocus
                    value={current.name}
                    onChange={e => setEditing({ ...current, name: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && current.name.trim()) updateMut.mutate({ id: dep.id, name: current.name.trim() });
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="flex-1 border border-blue-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    <Building2 size={13} className="text-blue-500" /> {dep.name}
                  </span>
                )}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {current ? (
                    <>
                      <button type="button" disabled={!current.name.trim() || updateMut.isPending} onClick={() => updateMut.mutate({ id: dep.id, name: current.name.trim() })} className="px-2.5 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                        {updateMut.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="p-1.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50"><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setEditing({ id: dep.id, name: dep.name })} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={13} /></button>
                      <button type="button" onClick={() => { if (confirm(`Delete "${dep.name}"?`)) deleteMut.mutate(dep.id); }} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>

        {!adding && (
          <div className="p-4 border-t border-gray-100">
            <button type="button" onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-600 py-2.5 rounded-md text-sm font-medium hover:bg-gray-50">
              <Plus size={14} /> Add Department
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; user?: any }>({ open: false });
  const [showDepartments, setShowDepartments] = useState(false);
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);

  const { data, isLoading } = useQuery({
    queryKey: ['users', search, page],
    queryFn: async () => {
      try {
        const r = await usersApi.list({ search, page, per_page: 20 });
        const users: LocalUser[] = r.data?.data?.data ?? r.data?.data ?? [];
        // Keep IndexedDB in sync (but don't clear pending-only temp entries)
        const serverIds = new Set(users.map((u: LocalUser) => u.id));
        const existing = await db.users.toArray();
        const pendingOnly = existing.filter(u => u.id < 0 || !serverIds.has(u.id));
        await db.transaction('rw', db.users, async () => {
          await db.users.bulkPut(users);
          // Re-add pending-only entries that haven't synced yet
          for (const p of pendingOnly) await db.users.put(p);
        });
        return r.data?.data;
      } catch {
        // Server unavailable — serve from IndexedDB immediately
        let cached = await db.users.toArray();
        if (search) {
          const q = search.toLowerCase();
          cached = cached.filter(u =>
            u.name?.toLowerCase().includes(q) ||
            (u.username as string)?.toLowerCase().includes(q)
          );
        }
        const total = cached.length;
        const perPage = 20;
        const from = (page - 1) * perPage;
        const pageData = cached.slice(from, from + perPage);
        return {
          data: pageData,
          meta: {
            last_page: Math.ceil(total / perPage) || 1,
            from: total === 0 ? 0 : from + 1,
            to: from + pageData.length,
            total,
          },
        };
      }
    },
    retry: false,
  });

  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      try {
        const r = await branchesApi.list();
        return r.data?.data || [];
      } catch {
        return [];
      }
    },
    retry: false,
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      try {
        const r = await departmentsApi.list();
        return r.data?.data || [];
      } catch {
        return [];
      }
    },
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      try {
        await usersApi.delete(id);
        await db.users.delete(id);
        return { offline: false };
      } catch {
        // If temp (negative) ID, just delete locally — no server call needed
        if (id < 0) {
          await db.users.delete(id);
          await db.pendingMutations
            .where('resource').equals('users')
            .filter(m => m.resourceId === id)
            .delete();
          return { offline: false };
        }
        await db.users.delete(id);
        await db.pendingMutations.add({
          id: makeMutId(),
          resource: 'users',
          action: 'delete',
          resourceId: id,
          payload: {},
          queuedAt: Date.now(),
          attempts: 0,
        });
        return { offline: true };
      }
    },
    onSuccess: (result) => {
      if (result.offline) {
        toast.success('Staff removed locally — will sync when server is back');
      } else {
        toast.success('Staff removed');
      }
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Cannot remove this staff member'),
  });

  const users: any[] = data?.data || [];
  const meta = data?.meta;
  const branches: any[] = Array.isArray(branchesData) ? branchesData : [];
  const departments: any[] = Array.isArray(departmentsData) ? departmentsData : [];
  const activeCount = users.filter(u => u.is_active).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {users.length} total · <span className="text-emerald-600 font-medium">{activeCount} active</span>
            {!isOnline && (
              <span className="ml-2 text-amber-600 inline-flex items-center gap-1">
                <WifiOff size={11} /> offline mode
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDepartments(true)}
            className="flex items-center gap-2 border border-gray-200 text-gray-600 font-semibold px-4 py-2.5 rounded-md text-sm hover:bg-gray-50 transition-colors"
          >
            <Building2 size={16} /> Departments
          </button>
          <button
            type="button"
            onClick={() => setModal({ open: true })}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-md text-sm shadow-md shadow-blue-100 transition-colors"
          >
            <Plus size={16} /> Add Employee
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search staff..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
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
          <p className="text-sm mt-1">{!isOnline ? 'No cached staff — add one to save offline' : 'Add your first team member'}</p>
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

      <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />

      {modal.open && <UserModal user={modal.user} branches={branches} departments={departments} onClose={() => setModal({ open: false })} />}
      {showDepartments && <DepartmentsModal departments={departments} onClose={() => setShowDepartments(false)} />}
    </div>
  );
}
