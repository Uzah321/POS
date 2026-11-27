import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AUTH_ME_QUERY_KEY } from '../components/auth/RouteGuards';
import api from '../lib/axios';
import { Shield, Save, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';
import PageTabs from '../components/PageTabs';
import { rememberTab } from '../lib/pageTabs';

interface Role { id: number; name: string; permissions?: { name: string }[] }
interface RolesData { roles: Role[]; permissions: { name: string }[] }

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((p) => b.has(p));

export default function RolePermissionPage() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['roles-permissions'],
    // Controller returns { roles, permissions } directly with no 'data' wrapper
    queryFn: () => api.get('/roles').then((res) => res.data as RolesData),
  });

  const roles = useMemo(() => data?.roles ?? [], [data]);
  const allPermissions: string[] = data?.permissions?.map((p) => p.name) ?? [];

  // Each role's permissions as saved; and, for a role ticked differently
  // here, what's ticked — until it's saved. Kept apart so a refetch (back to
  // this browser tab, say) doesn't undo ticks not saved yet.
  const savedPerms = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.name, new Set(r.permissions?.map((p) => p.name) ?? [])])),
    [roles],
  );
  const [edits, setEdits] = useState<Record<string, Set<string>>>({});
  const permsOf = (roleName: string) => edits[roleName] ?? savedPerms[roleName] ?? new Set<string>();
  const isUnsaved = (roleName: string) => !!edits[roleName] && !sameSet(edits[roleName], savedPerms[roleName] ?? new Set());

  // One role at a time; the #hash keeps it across a reload.
  const [picked, setPicked] = useState(() => decodeURIComponent(window.location.hash.replace(/^#/, '')));
  const activeRole = roles.find((r) => r.name === picked) ?? roles[0];
  const openRole = (name: string) => {
    setPicked(name);
    rememberTab(name);
  };

  const updateMutation = useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: number; roleName: string; permissions: string[] }) =>
      offlineMutate(() => api.put(`/roles/${roleId}`, { permissions }), 'roles', 'update', { _url: `/roles/${roleId}`, _method: 'PUT', permissions }, roleId),
    onSuccess: (result, { roleName, permissions }) => {
      if (result.offline) {
        toast.success(`${roleName} permissions saved offline - will sync when server is back`);
      } else {
        toast.success(`${roleName} permissions saved`);
        qc.setQueryData<RolesData>(['roles-permissions'], (old) => old && {
          ...old,
          roles: old.roles.map((r) => (r.name === roleName ? { ...r, permissions: permissions.map((name) => ({ name })) } : r)),
        });
        setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([name]) => name !== roleName)));
        qc.invalidateQueries({ queryKey: ['roles-permissions'] });
        qc.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
      }
      setSaving(null);
    },
    onError: () => setSaving(null),
  });

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
    setEdits(prev => {
      const set = new Set(prev[roleName] ?? savedPerms[roleName] ?? []);
      if (set.has(perm)) set.delete(perm); else set.add(perm);
      return { ...prev, [roleName]: set };
    });
  };

  const toggleGroup = (roleName: string, perms: string[], checked: boolean) => {
    setEdits(prev => {
      const set = new Set(prev[roleName] ?? savedPerms[roleName] ?? []);
      perms.forEach(p => (checked ? set.add(p) : set.delete(p)));
      return { ...prev, [roleName]: set };
    });
  };

  const handleSave = (role: Role) => {
    // Use role.id not role.name — route model binding uses the primary key
    setSaving(role.name);
    updateMutation.mutate({ roleId: role.id, roleName: role.name, permissions: Array.from(permsOf(role.name)) });
  };

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  const rolePerms = activeRole ? permsOf(activeRole.name) : new Set<string>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        <p className="text-sm text-gray-500 mt-1">Pick a role, then choose what it can access — tick a group's name to switch the whole group on or off</p>
      </div>

      {roles.length > 0 && activeRole ? (
        <>
          <PageTabs
            label="Roles"
            active={activeRole.name}
            onChange={openRole}
            tabs={roles.map((role) => ({
              key: role.name,
              label: role.name.charAt(0).toUpperCase() + role.name.slice(1),
              extra: (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                  {permsOf(role.name).size}
                </span>
              ),
              unsaved: isUnsaved(role.name),
            }))}
          />

          <div className="bg-white rounded-lg border border-gray-100 overflow-hidden shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-blue-500" />
                <h2 className="font-bold text-gray-900 capitalize">{activeRole.name}</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {rolePerms.size} / {allPermissions.length} active
                </span>
                {isUnsaved(activeRole.name) && <span className="text-xs font-medium text-amber-700">Changes not saved yet</span>}
              </div>
              <button
                type="button"
                onClick={() => handleSave(activeRole)}
                disabled={saving === activeRole.name}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {saving === activeRole.name ? <Save size={12} className="animate-spin" /> : <Check size={12} />}
                Save Changes
              </button>
            </div>

            <div className="grid grid-cols-1 gap-x-10 gap-y-5 p-6 lg:grid-cols-2">
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
                        onChange={() => toggleGroup(activeRole.name, perms, !allChecked)}
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
                          // `relative` keeps the hidden (sr-only, absolutely
                          // placed) checkbox inside its chip. Without it each
                          // one was placed against the whole browser page, and
                          // those low on the list made the window itself
                          // scroll: a second scrollbar, top bar scrolling away.
                          <label
                            key={perm}
                            className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${
                              checked
                                ? 'bg-blue-50 border-blue-200 text-blue-700'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <input type="checkbox" checked={checked} onChange={() => togglePerm(activeRole.name, perm)} className="sr-only" />
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
        </>
      ) : (
        <div className="bg-white rounded-lg border border-gray-100 p-12 text-center text-gray-400">
          <Shield size={32} className="mx-auto mb-2 text-gray-200" />
          <p>No roles found.</p>
        </div>
      )}
    </div>
  );
}
