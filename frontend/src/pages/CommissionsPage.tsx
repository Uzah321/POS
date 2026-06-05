import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { useCurrencyStore } from '../stores/currencyStore';
import { TrendingUp, Check, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CommissionsPage() {
  const { format } = useCurrencyStore();
  const qc = useQueryClient();
  const [dateFrom, setDateFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0,10));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<'all' | 'pending' | 'paid'>('all');

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['commissions-report', dateFrom, dateTo],
    queryFn: () => api.get('/commissions/report', { params: { date_from: dateFrom, date_to: dateTo } }).then(r => r.data?.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['commissions', tab, dateFrom, dateTo],
    queryFn: () => api.get('/commissions', { params: { status: tab === 'all' ? undefined : tab, date_from: dateFrom, date_to: dateTo } }).then(r => r.data?.data),
  });

  const markPaidMutation = useMutation({
    mutationFn: (ids: number[]) => api.post('/commissions/mark-paid', { ids }),
    onSuccess: () => { toast.success('Commissions marked as paid!'); qc.invalidateQueries({ queryKey: ['commissions'] }); qc.invalidateQueries({ queryKey: ['commissions-report'] }); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const commissions: any[] = data?.data ?? data ?? [];
  const reportData: any[] = report ?? [];

  const toggleSelect = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    const pending = commissions.filter((c: any) => c.status === 'pending');
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map((c: any) => c.id)));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Commissions</h1>
        <p className="text-sm text-gray-500 mt-1">Track and pay staff commissions</p>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-3">
        <Calendar size={16} className="text-gray-400" />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-gray-400 text-sm">to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Summary by staff */}
      {!reportLoading && reportData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {reportData.map((r: any) => (
            <div key={r.user_id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-sm font-semibold text-gray-800">{r.user_name}</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{format(r.total_amount)}</p>
              <div className="flex justify-between text-xs text-gray-400 mt-2">
                <span>{r.count} sales</span>
                <span className="text-amber-500">{format(r.pending_amount)} pending</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['all', 'pending', 'paid'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${tab === t ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{t}</button>
          ))}
        </div>
        {selected.size > 0 && (
          <button onClick={() => markPaidMutation.mutate(Array.from(selected))} disabled={markPaidMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            <Check size={14} /> Mark {selected.size} as Paid
          </button>
        )}
      </div>

      {/* Commissions list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : commissions.length === 0 ? (
          <div className="p-8 text-center text-gray-400"><TrendingUp size={32} className="mx-auto mb-2" /><p>No commissions in this period</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs font-semibold text-gray-500 uppercase">
                <th className="px-4 py-3">
                  <input type="checkbox" checked={selected.size === commissions.filter((c:any) => c.status==='pending').length && commissions.filter((c:any)=>c.status==='pending').length>0} onChange={toggleAll} className="rounded" />
                </th>
                <th className="text-left px-4 py-3">Staff</th>
                <th className="text-left px-4 py-3">Sale</th>
                <th className="text-right px-4 py-3">Rate</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {commissions.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {c.status === 'pending' && <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded" />}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium">{c.user?.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">#{c.sale_id}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-500">{c.rate}%</td>
                  <td className="px-4 py-3 text-sm text-right font-bold text-blue-600">{format(c.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
