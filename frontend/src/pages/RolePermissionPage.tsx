import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { Shield, Save, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';

export default function RolePermissionPage() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [localPerms, setLocalPerms] = useState<Record<string, Set<string>>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['roles-permissions'],
    queryFn: async () => {
      const res = await api.get('/roles');
      // Controller returns { roles, permissions } directly with no 'data' wrapper
      const d = res.data as { roles: any[]; permissions: any[] };
      const perms: Record<string, Set<string>> = {};
      (d?.roles ?? []).forEach((role: any) => {
        perms[role.name] = new Set(role.permissions?.map((p: any) => p.name) ?? []);
      });
      setLocalPerms(perms);
      return d;
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: number; roleName: string; permissions: string[] }) =>
      offlineMutate(() => api.put(`/roles/${roleId}`, { permissions }), 'roles', 'update', { _url: `/roles/${roleId}`, _method: 'PUT', permissions }, roleId),
    onSuccess: (result, { roleName }) => {
      if (result.offline) toast.success(`${roleName} permissions saved offline - will sync when server is back`);
      else { toast.success(`${roleName} permissions saved`); qc.invalidateQueries({ queryKey: ['roles-permissions'] }); }
      setSaving(null);
    },
  });

  const roles: any[] = data?.roles ?? [];
  const allPermissions: string[] = data?.permissions?.map((p: any) => p.name) ?? [];

  // Group permissions by the resource noun: "view_sales" -> "sales", "manage_users" -> "users"
  const permGroups = allPermissions.reduce((acc: Record<string, string[]>, perm) => {
    const parts = perm.split('_');
    const group = parts.length >= 2 ? parts.slice(1).join(' ') : parts[0];
    if (!acc[group]) acc[group] = [];
    acc[group].push(perm);
    return acc;
  }, {});

  const sortedGroups = Object.entries(permGroups).sort(([a], [b]) => a.localeCompare(b));

  const togglePerm = (roleName: string, perm: string) => {
    setLocalPerms(prev => {
      const set = new Set(prev[roleName] ?? []);
      set.has(perm) ? set.delete(perm) : set.add(perm);
      return { ...prev, [roleName]: set };
    });
  };

  const toggleGroup = (roleName: string, perms: string[], checked: boolean) => {
    setLocalPerms(prev => {
      const set = new Set(prev[roleName] ?? []);
      perms.forEach(p => checked ? set.add(p) : set.delete(p));
      return { ...prev, [roleName]: set };
    });
  };

  const handleSave = (roleName: string) => {
    // Use role.id not role.name — route model binding uses the primary key
    const role = roles.find(r => r.name === roleName);
    if (!role) return;
    setSaving(roleName);
    updateMutation.mutate({ roleId: role.id, roleName, permissions: Array.from(localPerms[roleName] ?? []) });
  };

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        <p className="text-sm text-gray-500 mt-1">Configure what each role can access — click a group header to toggle all permissions in that group</p>
      </div>

      <div className="space-y-6">
        {roles.map((role: any) => {
          const rolePerms = localPerms[role.name] ?? new Set<string>();
          return (
            <div key={role.name} className="bg-white rounded-lg border border-gray-100 overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-blue-500" />
                  <h2 className="font-bold text-gray-900 capitalize">{role.name}</h2>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {rolePerms.size} / {allPermissions.length} active
                  </span>
                </div>
                <button
                  onClick={() => handleSave(role.name)}
                  disabled={saving === role.name}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === role.name ? <Save size={12} className="animate-spin" /> : <Check size={12} />}
                  Save Changes
                </button>
              </div>

              <div className="p-6 space-y-5">
                {sortedGroups.map(([group, perms]) => {
                  const allChecked  = perms.every(p => rolePerms.has(p));
                  const someChecked = perms.some(p => rolePerms.has(p));
                  return (
                    <div key={group}>
                      <label className="flex items-center gap-2 mb-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                          onChange={() => toggleGroup(role.name, perms, !allChecked)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide capitalize select-none">
                          {group}
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2 pl-5">
                        {perms.map(perm => {
                          const checked = rolePerms.has(perm);
                          const verb = perm.split('_')[0];
                          return (
                            <label
                              key={perm}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${
                                checked
                                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                                  : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              <input type="checkbox" checked={checked} onChange={() => togglePerm(role.name, perm)} className="sr-only" />
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${checked ? 'bg-blue-500' : 'bg-gray-300'}`} />
                              <span className="capitalize">{verb}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {roles.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-100 p-12 text-center text-gray-400">
            <Shield size={32} className="mx-auto mb-2 text-gray-200" />
            <p>No roles found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
