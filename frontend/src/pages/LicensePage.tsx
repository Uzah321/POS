import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Plus, RefreshCw, Ban, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { licenseApi } from '../api';

const STATE_STYLE: Record<string, string> = {
  valid: 'bg-emerald-100 text-emerald-700',
  expiring: 'bg-amber-100 text-amber-800',
  expired: 'bg-red-100 text-red-700',
  revoked: 'bg-red-100 text-red-700',
  invalid: 'bg-red-100 text-red-700',
  unlicensed: 'bg-gray-100 text-gray-600',
  active: 'bg-emerald-100 text-emerald-700',
};

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export default function LicensePage() {
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [clientName, setClientName] = useState('');

  const { data: status, isLoading } = useQuery({
    queryKey: ['license-status'],
    queryFn: () => licenseApi.status().then(r => r.data?.data),
  });

  const activate = useMutation({
    mutationFn: () => licenseApi.activate(key),
    onSuccess: () => { toast.success('License activated'); setKey(''); qc.invalidateQueries({ queryKey: ['license-status'] }); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Could not activate license'),
  });

  const serverMode = !!status?.server_enabled;
  const { data: licenses = [] } = useQuery({
    queryKey: ['licenses'],
    queryFn: () => licenseApi.list().then(r => r.data?.data ?? []),
    enabled: serverMode,
  });
  const refreshList = () => qc.invalidateQueries({ queryKey: ['licenses'] });

  const issue = useMutation({
    mutationFn: () => licenseApi.issue({ client_name: clientName }),
    onSuccess: () => { toast.success('License issued'); setClientName(''); refreshList(); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Could not issue license'),
  });
  const renew = useMutation({
    mutationFn: (id: number) => licenseApi.renew(id),
    onSuccess: () => { toast.success('Renewed for 1 month'); refreshList(); },
  });
  const revoke = useMutation({
    mutationFn: (id: number) => licenseApi.revoke(id),
    onSuccess: () => { toast.success('License revoked'); refreshList(); },
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">License</h1>
        <p className="text-gray-500 text-sm">Monthly license for this installation.</p>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-gray-100 p-5 space-y-4">
        {isLoading ? <Loader2 className="animate-spin text-gray-400" /> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATE_STYLE[status?.state] ?? ''}`}>{status?.state}</span>
            </div>
            <div><p className="text-xs text-gray-500">Licensed to</p><p className="font-semibold mt-1">{status?.client ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">Expires</p><p className="font-semibold mt-1">{fmtDate(status?.expires_at)}</p></div>
            <div><p className="text-xs text-gray-500">Days left</p><p className="font-semibold mt-1">{status?.days_left != null ? Math.max(status.days_left, 0) : '—'}</p></div>
          </div>
        )}
        {status && !status.enforced && (
          <p className="text-xs text-gray-500">License enforcement is switched off on this install (set <code>LICENSE_ENFORCE=true</code> to enable it).</p>
        )}

        <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) activate.mutate(); }} className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          <div className="relative flex-1 min-w-[240px]">
            <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <button
            type="submit"
            disabled={!key.trim() || activate.isPending}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-md text-sm"
          >
            {activate.isPending ? 'Checking…' : status?.state === 'unlicensed' ? 'Activate' : 'Apply key / refresh'}
          </button>
        </form>
      </div>

      {serverMode && (
        <div className="bg-white rounded-md shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Issued licenses</h2>
          <form onSubmit={(e) => { e.preventDefault(); if (clientName.trim()) issue.mutate(); }} className="flex flex-wrap gap-2">
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name"
              className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              type="submit"
              disabled={!clientName.trim() || issue.isPending}
              className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-md text-sm"
            >
              <Plus size={15} /> Issue 1-month license
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50">
                <tr>{['Client', 'Key', 'Expires', 'Status', 'Last seen', ''].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(licenses as any[]).map((l) => {
                  const expired = new Date(l.expires_at) < new Date();
                  const shown = l.status === 'revoked' ? 'revoked' : expired ? 'expired' : 'active';
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-3 font-medium">{l.client_name}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {l.key}
                        <button
                          type="button"
                          title="Copy key"
                          onClick={() => { navigator.clipboard?.writeText(l.key); toast.success('Key copied'); }}
                          className="ml-2 text-gray-400 hover:text-gray-700 align-middle"
                        >
                          <Copy size={13} />
                        </button>
                      </td>
                      <td className="px-4 py-3">{fmtDate(l.expires_at)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATE_STYLE[shown]}`}>{shown}</span></td>
                      <td className="px-4 py-3 text-gray-500">{fmtDate(l.last_seen_at)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => renew.mutate(l.id)} className="inline-flex items-center gap-1 text-blue-600 hover:underline mr-3">
                          <RefreshCw size={13} /> Renew +1 month
                        </button>
                        {l.status !== 'revoked' && (
                          <button
                            type="button"
                            onClick={() => { if (confirm('Revoke ' + l.client_name + ' license?')) revoke.mutate(l.id); }}
                            className="inline-flex items-center gap-1 text-red-600 hover:underline"
                          >
                            <Ban size={13} /> Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(licenses as any[]).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No licenses issued yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
