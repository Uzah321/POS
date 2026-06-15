import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

type KdsStatus = 'new' | 'preparing' | 'ready' | 'served';

interface KdsItem  { name: string; qty: number; }
interface KdsOrder {
  id: number;
  ticket: string;
  reference: string;
  kds_status: KdsStatus;
  items: KdsItem[];
  placed_at: string;
}

const STATUS_NEXT: Record<KdsStatus, KdsStatus | null> = {
  new:       'preparing',
  preparing: 'ready',
  ready:     'served',
  served:    null,
};

const STATUS_LABEL: Record<KdsStatus, string> = {
  new:       'Bump to Preparing',
  preparing: 'Mark Ready',
  ready:     'Served',
  served:    'Done',
};

const STATUS_COLOR: Record<KdsStatus, string> = {
  new:       'border-blue-500  bg-gray-900',
  preparing: 'border-amber-400 bg-gray-900',
  ready:     'border-green-400 bg-gray-900',
  served:    'border-gray-600  bg-gray-900',
};

const STATUS_BADGE: Record<KdsStatus, string> = {
  new:       'bg-blue-600  text-white',
  preparing: 'bg-amber-500 text-white',
  ready:     'bg-green-500 text-white',
  served:    'bg-gray-600  text-white',
};

const BTN_COLOR: Record<KdsStatus, string> = {
  new:       'bg-amber-500 hover:bg-amber-400 text-white',
  preparing: 'bg-green-500 hover:bg-green-400 text-white',
  ready:     'bg-gray-600  hover:bg-gray-500  text-white',
  served:    'bg-gray-700  text-gray-400 cursor-default',
};

function elapsed(placed_at: string): string {
  const secs = Math.floor((Date.now() - new Date(placed_at).getTime()) / 1000);
  if (secs < 60)  return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function useElapsed() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(n => n + 1), 1000); return () => clearInterval(t); }, []);
}

export default function KitchenDisplayPage() {
  const [orders, setOrders]   = useState<KdsOrder[]>([]);
  const [updating, setUpdating] = useState<Set<number>>(new Set());
  const [error, setError]     = useState('');
  const prevIds               = useRef<Set<number>>(new Set());
  const audio                 = useRef<AudioContext | null>(null);
  useElapsed();

  const beep = () => {
    try {
      if (!audio.current) audio.current = new AudioContext();
      const ctx = audio.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.3;
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } catch {}
  };

  const fetchOrders = async () => {
    try {
      const { data } = await axios.get('/api/kds/orders');
      const list: KdsOrder[] = data.data ?? [];
      const newIds = new Set(list.map(o => o.id));
      const hasNew = list.some(o => o.kds_status === 'new' && !prevIds.current.has(o.id));
      if (hasNew) beep();
      prevIds.current = newIds;
      setOrders(list);
      setError('');
    } catch {
      setError('Cannot reach server');
    }
  };

  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, 4000);
    return () => clearInterval(t);
  }, []);

  const bump = async (order: KdsOrder) => {
    const next = STATUS_NEXT[order.kds_status];
    if (!next) return;
    setUpdating(prev => new Set(prev).add(order.id));
    try {
      await axios.patch(`/api/kds/orders/${order.id}/status`, { status: next });
      await fetchOrders();
    } catch {}
    setUpdating(prev => { const s = new Set(prev); s.delete(order.id); return s; });
  };

  const active  = orders.filter(o => o.kds_status !== 'served');
  const newCnt  = orders.filter(o => o.kds_status === 'new').length;
  const prepCnt = orders.filter(o => o.kds_status === 'preparing').length;
  const readyCnt= orders.filter(o => o.kds_status === 'ready').length;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="font-bold text-xl text-white tracking-tight">Kitchen Display</span>
          {error
            ? <span className="text-red-400 text-sm">{error}</span>
            : <span className="text-gray-600 text-xs font-mono hidden lg:inline">
                {window.location.protocol}//{window.location.host}/kitchen
              </span>
          }
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
            <span className="text-gray-400">New</span>
            <span className="font-bold text-white ml-1">{newCnt}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
            <span className="text-gray-400">Preparing</span>
            <span className="font-bold text-white ml-1">{prepCnt}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"></span>
            <span className="text-gray-400">Ready</span>
            <span className="font-bold text-white ml-1">{readyCnt}</span>
          </span>
        </div>
      </div>

      {/* Order grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {active.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-700 select-none">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
            <p className="text-2xl font-semibold">All clear — no pending orders</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {active.map(order => {
              const isNew = order.kds_status === 'new';
              return (
                <div key={order.id}
                  className={`rounded-xl border-2 ${STATUS_COLOR[order.kds_status]} flex flex-col overflow-hidden
                    ${isNew ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-950' : ''}`}>

                  {/* Card header */}
                  <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                    <span className="font-black text-3xl text-white tabular-nums">{order.ticket}</span>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${STATUS_BADGE[order.kds_status]}`}>
                        {order.kds_status}
                      </span>
                      <span className={`text-xs tabular-nums ${
                        elapsed(order.placed_at).includes('m') && parseInt(elapsed(order.placed_at)) > 5
                          ? 'text-red-400 font-bold' : 'text-gray-500'
                      }`}>
                        {elapsed(order.placed_at)}
                      </span>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="flex-1 px-4 py-3 space-y-1.5 min-h-0">
                    {order.items.map((item, i) => (
                      <div key={i} className="flex items-baseline gap-2">
                        <span className="text-amber-400 font-bold text-lg tabular-nums w-6 text-right flex-shrink-0">
                          {item.qty}×
                        </span>
                        <span className="text-white text-base font-medium leading-tight">{item.name}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action button */}
                  <div className="px-4 pb-4 pt-2">
                    {order.kds_status !== 'served' && (
                      <button
                        onClick={() => bump(order)}
                        disabled={updating.has(order.id)}
                        className={`w-full py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-50 ${BTN_COLOR[order.kds_status]}`}>
                        {updating.has(order.id) ? '...' : STATUS_LABEL[order.kds_status]}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
