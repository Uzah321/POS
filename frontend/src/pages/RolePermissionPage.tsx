import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { Shield, Save, Check } from 'lucide-react';
import toast from 'react-hot-toast';

export default function RolePermissionPage() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [localPerms, setLocalPerms] = useState<Record<string, Set<string>>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['roles-permissions'],
    queryFn: async () => {
      const res = await api.get('/roles');
      const d = res.data?.data;
      const perms: Record<string, Set<string>> = {};
      d?.roles?.forEach((role: any) => {
        perms[role.name] = new Set(role.permissions?.map((p: any) => p.name) ?? []);
      });
      setLocalPerms(perms);
      return d;
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ role, permissions }: { role: string; permissions: string[] }) => api.put(`/roles/${role}`, { permissions }),
    onSuccess: (_, { role }) => { toast.success(`${role} updated!`); qc.invalidateQueries({ queryKey: ['roles-permissions'] }); setSaving(null); },
    onError: (e: any) => { toast.error(e.response?.data?.message || 'Failed'); setSaving(null); },
  });

  const roles: any[] = data?.roles ?? [];
  const allPermissions: string[] = data?.permissions?.map((p: any) => p.name) ?? [];

  // Group permissions by prefix
  const permGroups = allPermissions.reduce((acc: Record<string, string[]>, perm) => {
    const group = perm.split(' ').pop()?.split('-')[0] ?? 'other';
    if (!acc[group]) acc[group] = [];
    acc[group].push(perm);
    return acc;
  }, {});

  const togglePerm = (role: string, perm: string) => {
    setLocalPerms(prev => {
      const set = new Set(prev[role] ?? []);
      set.has(perm) ? set.delete(perm) : set.add(perm);
      return { ...prev, [role]: set };
    });
  };

  const handleSave = (roleName: string) => {
    setSaving(roleName);
    updateMutation.mutate({ role: roleName, permissions: Array.from(localPerms[roleName] ?? []) });
  };

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        <p className="text-sm text-gray-500 mt-1">Configure what each role can access</p>
      </div>

      <div className="space-y-6">
        {roles.map((role: any) => (
          <div key={role.name} className="bg-white rounded-lg border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-blue-500" />
                <h2 className="font-bold text-gray-900 capitalize">{role.name}</h2>
                <span className="text-xs text-gray-400">{localPerms[role.name]?.size ?? 0} permissions</span>
              </div>
              <button
                onClick={() => handleSave(role.name)}
                disabled={saving === role.name}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {saving === role.name ? <Save size={12} className="animate-spin" /> : <Check size={12} />} Save
              </button>
            </div>
            <div className="p-6">
              {Object.entries(permGroups).map(([group, perms]) => (
                <div key={group} className="mb-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{group}</p>
                  <div className="flex flex-wrap gap-2">
                    {perms.map(perm => {
                      const checked = localPerms[role.name]?.has(perm) ?? false;
                      return (
                        <label key={perm} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${checked ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                          <input type="checkbox" checked={checked} onChange={() => togglePerm(role.name, perm)} className="sr-only" />
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${checked ? 'bg-blue-500' : 'bg-gray-300'}`} />
                          {perm}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
