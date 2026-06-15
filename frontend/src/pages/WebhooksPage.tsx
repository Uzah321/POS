import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { Plus, X, Zap, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

const AVAILABLE_EVENTS = ['sale.created', 'sale.refunded', 'product.low_stock', 'layby.created', 'layby.paid', 'customer.created', 'stocktake.completed'];

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', url: '', secret: '', events: [] as string[] });

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get('/webhooks').then(r => r.data?.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/webhooks', data),
    onSuccess: () => { toast.success('Webhook created!'); qc.invalidateQueries({ queryKey: ['webhooks'] }); setShowNew(false); setForm({ name: '', url: '', secret: '', events: [] }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: any) => api.put(`/webhooks/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/webhooks/${id}`),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['webhooks'] }); },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => api.post(`/webhooks/${id}/test`),
    onSuccess: () => { toast.success('Test payload sent!'); setTestingId(null); qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e: any) => { toast.error(e.response?.data?.message || 'Test failed'); setTestingId(null); },
  });

  const webhooks: any[] = data?.data ?? data ?? [];

  const toggleEvent = (event: string) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter(e => e !== event) : [...f.events, event],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-sm text-gray-500 mt-1">Send real-time events to external services</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700">
          <Plus size={16} /> Add Webhook
        </button>
      </div>

      <div className="space-y-3">
        {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : webhooks.length === 0 ? (
          <div className="p-8 text-center text-gray-400 bg-white rounded-lg border border-gray-100">
            <Zap size={32} className="mx-auto mb-2" /><p>No webhooks configured</p>
          </div>
        ) : (
          webhooks.map((w: any) => (
            <div key={w.id} className={`bg-white rounded-lg border p-5 ${w.active ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{w.name}</h3>
                    {w.active ? <span className="w-2 h-2 rounded-full bg-emerald-500" /> : <span className="w-2 h-2 rounded-full bg-gray-300" />}
                  </div>
                  <p className="text-xs font-mono text-gray-500 mt-1 break-all">{w.url}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(w.events ?? []).map((e: string) => (
                      <span key={e} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-xs font-medium">{e}</span>
                    ))}
                  </div>
                  {w.last_triggered_at && (
                    <p className="text-xs text-gray-400 mt-2">Last triggered: {new Date(w.last_triggered_at).toLocaleString()}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button onClick={() => { setTestingId(w.id); testMutation.mutate(w.id); }} disabled={testMutation.isPending && testingId === w.id} className="flex items-center gap-1 px-3 py-1.5 border border-blue-200 text-blue-600 rounded-md text-xs font-semibold hover:bg-blue-50 disabled:opacity-50">
                    <Zap size={12} /> Test
                  </button>
                  <button onClick={() => toggleMutation.mutate({ id: w.id, active: !w.active })} className="text-gray-400 hover:text-blue-600">
                    {w.active ? <ToggleRight size={22} className="text-emerald-500" /> : <ToggleLeft size={22} />}
                  </button>
                  <button onClick={() => { if (confirm('Delete webhook?')) deleteMutation.mutate(w.id); }} className="text-gray-300 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-gray-900">New Webhook</h2>
              <button onClick={() => setShowNew(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Name</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="My Integration" className="w-full mt-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Endpoint URL</label>
                <input value={form.url} onChange={e => setForm({...form, url: e.target.value})} placeholder="https://hooks.example.com/pos" className="w-full mt-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Secret (optional)</label>
                <input value={form.secret} onChange={e => setForm({...form, secret: e.target.value})} placeholder="Signing secret" className="w-full mt-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Events</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {AVAILABLE_EVENTS.map(event => (
                    <label key={event} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${form.events.includes(event) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
                      <input type="checkbox" checked={form.events.includes(event)} onChange={() => toggleEvent(event)} className="sr-only" />
                      {event}
                    </label>
                  ))}
                </div>
              </div>
              <button onClick={() => createMutation.mutate(form)} disabled={!form.name || !form.url || form.events.length === 0 || createMutation.isPending} className="w-full bg-blue-600 text-white font-semibold py-3 rounded-md hover:bg-blue-700 disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Create Webhook'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
