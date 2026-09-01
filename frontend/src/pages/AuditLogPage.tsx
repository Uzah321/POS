import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/axios';
import { Search, Shield, Clock, ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import Pagination from '../components/ui/Pagination';
import toast from 'react-hot-toast';

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-700',
  updated: 'bg-blue-100 text-blue-700',
  deleted: 'bg-red-100 text-red-700',
  login: 'bg-purple-100 text-purple-700',
  logout: 'bg-gray-100 text-gray-600',
};

const SKIP_FIELDS = new Set(['updated_at', 'created_at', 'slug', 'password', 'remember_token', 'items']);

function getChanges(log: any): Array<{ field: string; old: string; new: string }> {
  if (log.event !== 'updated' || !log.old_values) return [];
  return Object.entries(log.old_values as Record<string, unknown>)
    .filter(([f]) => !SKIP_FIELDS.has(f))
    .map(([f, oldVal]) => ({
      field: f,
      old: String(oldVal ?? ''),
      new: String((log.new_values?.[f]) ?? ''),
    }));
}

// Line-item detail attached after the parent record was logged (see
// AuditLog::attachExtra on the backend) — e.g. the products/quantities in a
// stock adjustment or transfer, which don't exist yet at the moment the
// parent row itself gets its "created" audit entry.
function getItems(log: any): any[] {
  const items = log.new_values?.items ?? log.old_values?.items;
  return Array.isArray(items) ? items : [];
}

function ItemsTable({ items }: { items: any[] }) {
  const hasAdjustment = items.some(i => 'quantity_before' in i);
  const hasReceived   = items.some(i => 'received_quantity' in i);
  const hasPlainQty   = items.some(i => 'quantity' in i) && !hasAdjustment && !hasReceived;

  return (
    <table className="text-xs w-full max-w-2xl">
      <thead>
        <tr className="text-gray-500">
          <th className="text-left pr-4 py-1 font-semibold">Product</th>
          {hasAdjustment && <>
            <th className="text-left pr-4 py-1 font-semibold">Before</th>
            <th className="text-left pr-4 py-1 font-semibold">Change</th>
            <th className="text-left pr-4 py-1 font-semibold">After</th>
            <th className="text-left py-1 font-semibold">Cost</th>
          </>}
          {hasPlainQty && <th className="text-left py-1 font-semibold">Quantity</th>}
          {hasReceived && <>
            <th className="text-left pr-4 py-1 font-semibold">Received</th>
            <th className="text-left pr-4 py-1 font-semibold">Dest. Before</th>
            <th className="text-left py-1 font-semibold">Dest. After</th>
          </>}
        </tr>
      </thead>
      <tbody>
        {items.map((it, idx) => (
          <tr key={idx} className="border-t border-blue-100">
            <td className="pr-4 py-1 font-medium text-gray-800">
              {it.product_name ?? `#${it.product_id}`}
              {it.product_sku && <span className="text-gray-400 font-normal"> ({it.product_sku})</span>}
            </td>
            {hasAdjustment && <>
              <td className="pr-4 py-1 text-gray-600">{it.quantity_before}</td>
              <td className={`pr-4 py-1 font-semibold ${Number(it.quantity_adjusted) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {Number(it.quantity_adjusted) > 0 ? '+' : ''}{it.quantity_adjusted}
              </td>
              <td className="pr-4 py-1 text-gray-600">{it.quantity_after}</td>
              <td className="py-1 text-gray-600">{it.cost_price}</td>
            </>}
            {hasPlainQty && <td className="py-1 text-gray-600">{it.quantity}</td>}
            {hasReceived && <>
              <td className="pr-4 py-1 text-gray-600">{it.received_quantity}</td>
              <td className="pr-4 py-1 text-gray-600">{it.destination_before}</td>
              <td className="py-1 text-gray-600">{it.destination_after}</td>
            </>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LogRow({ log }: { log: any }) {
  const [expanded, setExpanded] = useState(false);
  const changes = getChanges(log);
  const items = getItems(log);
  const hasDetail = changes.length > 0 || items.length > 0;

  return (
    <>
      <tr className="hover:bg-gray-50 cursor-default" onClick={() => hasDetail && setExpanded(e => !e)}>
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          <div className="flex items-center gap-1"><Clock size={11} />{new Date(log.created_at).toLocaleString()}</div>
        </td>
        <td className="px-4 py-3 text-sm font-medium">{log.user?.name ?? 'System'}</td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-600'}`}>{log.action}</span>
        </td>
        <td className="px-4 py-3 text-xs text-gray-600 max-w-lg">
          <div className="flex items-start gap-1">
            {hasDetail && (
              <span className="mt-0.5 text-gray-400 flex-shrink-0">
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            )}
            <span>{log.description ?? '-'}</span>
          </div>
        </td>
      </tr>
      {expanded && hasDetail && (
        <tr className="bg-blue-50 border-b border-blue-100">
          <td colSpan={4} className="px-8 py-2">
            {items.length > 0 ? <ItemsTable items={items} /> : (
              <table className="text-xs w-full max-w-lg">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left pr-4 py-1 font-semibold">Field</th>
                    <th className="text-left pr-4 py-1 font-semibold">Before</th>
                    <th className="text-left py-1 font-semibold">After</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(c => (
                    <tr key={c.field} className="border-t border-blue-100">
                      <td className="pr-4 py-1 font-mono text-gray-600">{c.field}</td>
                      <td className="pr-4 py-1 text-red-600 line-through max-w-[120px] truncate" title={c.old}>{c.old || <span className="text-gray-300 no-underline">empty</span>}</td>
                      <td className="py-1 text-emerald-700 font-medium max-w-[120px] truncate" title={c.new}>{c.new || <span className="text-gray-300">empty</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditLogPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userId, setUserId] = useState('');
  const [downloading, setDownloading] = useState(false);

  const filterParams = {
    search: search || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    user_id: userId || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, search, dateFrom, dateTo, userId],
    queryFn: () => api.get('/audit-logs', { params: { page, ...filterParams, per_page: 50 } }).then(r => r.data?.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['audit-log-users'],
    queryFn: () => api.get('/audit-logs/users').then(r => r.data?.data ?? []),
  });
  const filterUsers: Array<{ id: number; name: string }> = usersData ?? [];

  const logs: any[] = data?.data ?? data ?? [];
  const meta = data?.meta ?? {};

  const handleDownloadPdf = () => {
    setDownloading(true);
    const params = new URLSearchParams(
      Object.entries(filterParams).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    const token = localStorage.getItem('token');
    fetch(`/api/audit-logs/pdf${params ? `?${params}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.pdf`;
        a.click();
      })
      .catch(() => toast.error('Could not generate the audit log PDF'))
      .finally(() => setDownloading(false));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-1">Track all system changes — click a row with details to expand it</p>
        </div>
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={downloading}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Download PDF
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search actions, users..." className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select
          value={userId}
          onChange={e => { setUserId(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All users</option>
          {filterUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-gray-400 text-sm">to</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><Shield size={32} className="mx-auto mb-2" /><p>No audit logs found</p></div>
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-xs font-semibold text-gray-500 uppercase">
                  <th className="text-left px-4 py-3">Time</th>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log: any) => <LogRow key={log.id} log={log} />)}
              </tbody>
            </table>
            </div>
            <Pagination page={page} lastPage={meta?.last_page ?? 1} from={meta?.from} to={meta?.to} total={meta?.total} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
