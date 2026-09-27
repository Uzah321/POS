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

const SKIP_FIELDS = new Set(['updated_at', 'created_at', 'slug', 'password', 'remember_token', 'items', '_refs', 'id']);

// "warehouse_id" -> "Warehouse", "selling_price" -> "Selling Price"
function fieldLabel(field: string): string {
  return field.replace(/_id$/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// The backend resolves foreign-key ids (warehouse_id, customer_id, ...) to
// names at the moment the log is written — show those instead of raw ids.
function refName(log: any, field: string, value: unknown): string {
  const name = log.new_values?._refs?.[field]?.[String(value)];
  return name ?? fmt(value);
}

// "5" resubmitted over a stored 5.000 isn't a change — hide it (matches AuditLog::sameValue).
function sameValue(a: unknown, b: unknown): boolean {
  const isNum = (v: unknown) => v !== null && v !== '' && typeof v !== 'boolean' && !isNaN(Number(v));
  if (isNum(a) && isNum(b)) return Number(a) === Number(b);
  return fmt(a) === fmt(b);
}

function getChanges(log: any): Array<{ field: string; old: string; new: string }> {
  if (log.event !== 'updated' || !log.old_values) return [];
  return Object.entries(log.old_values as Record<string, unknown>)
    .filter(([f, oldVal]) => !SKIP_FIELDS.has(f) && !sameValue(oldVal, log.new_values?.[f]))
    .map(([f, oldVal]) => ({
      field: f,
      old: refName(log, f, oldVal),
      new: refName(log, f, log.new_values?.[f]),
    }));
}

// Every field of a created/deleted record, so nothing about it is hidden.
function getFields(log: any): Array<{ field: string; value: string }> {
  if (log.event !== 'created' && log.event !== 'deleted') return [];
  const values = { ...(log.old_values ?? {}), ...(log.new_values ?? {}) } as Record<string, unknown>;
  return Object.entries(values)
    .filter(([f, v]) => !SKIP_FIELDS.has(f) && v !== null && v !== '' && typeof v !== 'object')
    .map(([f, v]) => ({ field: f, value: refName(log, f, v) }));
}

// Products/ingredients and quantities involved (sale lines, adjustment lines,
// transfer lines, PO lines, stock count lines...).
function getItems(log: any): any[] {
  const items = log.new_values?.items ?? log.old_values?.items;
  return Array.isArray(items) ? items : [];
}

// Columns shown in the items table, in order — only the ones the entry actually has.
const ITEM_COLUMNS: Array<{ key: string; label: string; signed?: boolean }> = [
  { key: 'quantity', label: 'Qty' },
  { key: 'quantity_before', label: 'Before' },
  { key: 'quantity_adjusted', label: 'Change', signed: true },
  { key: 'quantity_after', label: 'After' },
  { key: 'expected', label: 'Expected' },
  { key: 'counted', label: 'Counted' },
  { key: 'variance', label: 'Variance', signed: true },
  { key: 'received_quantity', label: 'Received' },
  { key: 'destination_before', label: 'Dest. Before' },
  { key: 'destination_after', label: 'Dest. After' },
  { key: 'unit', label: 'Unit' },
  { key: 'unit_price', label: 'Unit Price' },
  { key: 'cost_price', label: 'Cost' },
  { key: 'discount', label: 'Discount' },
  { key: 'total', label: 'Total' },
  { key: 'restocked', label: 'Restocked' },
  { key: 'batch', label: 'Batch' },
];

function ItemsTable({ items }: { items: any[] }) {
  const columns = ITEM_COLUMNS.filter(c => items.some(i => i[c.key] !== undefined && i[c.key] !== null));

  return (
    <table className="text-xs w-full max-w-3xl">
      <thead>
        <tr className="text-gray-500">
          <th className="text-left pr-4 py-1 font-semibold">Product</th>
          {columns.map(c => <th key={c.key} className="text-left pr-4 py-1 font-semibold">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {items.map((it, idx) => (
          <tr key={idx} className="border-t border-blue-100">
            <td className="pr-4 py-1 font-medium text-gray-800">
              {it.product_name ?? it.name ?? `#${it.product_id}`}
              {it.product_sku && <span className="text-gray-400 font-normal"> ({it.product_sku})</span>}
            </td>
            {columns.map(c => {
              const v = it[c.key];
              const n = Number(v);
              const color = c.signed && v != null ? (n < 0 ? 'text-red-600 font-semibold' : n > 0 ? 'text-emerald-700 font-semibold' : 'text-gray-600') : 'text-gray-600';
              return (
                <td key={c.key} className={`pr-4 py-1 ${color}`}>
                  {v == null ? '-' : `${c.signed && n > 0 ? '+' : ''}${fmt(v)}`}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldsTable({ fields }: { fields: Array<{ field: string; value: string }> }) {
  return (
    <table className="text-xs w-full max-w-lg">
      <tbody>
        {fields.map(f => (
          <tr key={f.field} className="border-t border-blue-100">
            <td className="pr-4 py-1 text-gray-500 whitespace-nowrap">{fieldLabel(f.field)}</td>
            <td className="py-1 text-gray-800 break-all">{f.value}</td>
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
  const fields = getFields(log);
  const hasDetail = changes.length > 0 || items.length > 0 || fields.length > 0;

  return (
    <>
      <tr className={`hover:bg-gray-50 ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`} onClick={() => hasDetail && setExpanded(e => !e)}>
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          <div className="flex items-center gap-1"><Clock size={11} />{new Date(log.created_at).toLocaleString()}</div>
        </td>
        <td className="px-4 py-3 text-sm font-medium">{log.user?.name ?? 'System'}</td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-600'}`}>{log.action}</span>
        </td>
        <td className="px-4 py-3 text-xs text-gray-600 max-w-2xl">
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
          <td colSpan={4} className="px-8 py-3 space-y-3">
            {items.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1">Items</p>
                <ItemsTable items={items} />
              </div>
            )}
            {changes.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1">Changes</p>
                <table className="text-xs w-full max-w-2xl">
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
                        <td className="pr-4 py-1 text-gray-600">{fieldLabel(c.field)}</td>
                        <td className="pr-4 py-1 text-red-600 line-through break-all">{c.old || <span className="text-gray-300 no-underline">empty</span>}</td>
                        <td className="py-1 text-emerald-700 font-medium break-all">{c.new || <span className="text-gray-300">empty</span>}</td>
                      </tr>
                    ))}
                    {log.new_values?.stock_on_hand != null && (
                      <tr className="border-t border-blue-100">
                        <td className="pr-4 py-1 font-semibold text-gray-700">Stock on hand</td>
                        <td colSpan={2} className="py-1 font-semibold text-gray-800">{fmt(log.new_values.stock_on_hand)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {fields.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1">{log.event === 'deleted' ? 'Deleted record' : 'Record details'}</p>
                <FieldsTable fields={fields} />
              </div>
            )}
            {(log.ip_address || log.url) && (
              <p className="text-[11px] text-gray-400">
                {log.ip_address && <>IP {log.ip_address}</>}
                {log.ip_address && log.url && ' · '}
                {log.url}
              </p>
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
    fetch(`/api/audit-logs/pdf${params ? `?${params}` : ''}`, { credentials: 'include' })
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
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search products, actions, users..." className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
