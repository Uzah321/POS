import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { loadKdsSettings, getKdsTheme } from '../lib/kdsSettings';
import { useNetworkUrl } from '../hooks/useNetworkUrl';

type KdsStatus = 'new' | 'preparing' | 'ready' | 'served';

interface KdsItem  { name: string; qty: number; variant?: string | null; description?: string | null; note?: string | null; }
interface KdsOrder {
  id: number;
  ticket: string;
  reference: string;
  kds_status: KdsStatus;
  table_number?: string | null;
  order_type?: string | null;
  customer?: string | null;
  notes?: string | null;
  items: KdsItem[];
  placed_at: string;
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  sit_in: 'Sit-in',
  takeaway: 'Takeaway',
};

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

const BTN_COLOR: Record<KdsStatus, string> = {
  new:       'bg-amber-500 hover:bg-amber-400 text-white',
  preparing: 'bg-green-500 hover:bg-green-400 text-white',
  ready:     'bg-gray-600  hover:bg-gray-500  text-white',
  served:    'bg-gray-700  text-gray-400 cursor-default',
};

function elapsed(placed_at: string): string {
  const secs = Math.floor((Date.now() - new Date(placed_at).getTime()) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function isUrgent(placed_at: string, urgentMinutes: number): boolean {
  return (Date.now() - new Date(placed_at).getTime()) / 60000 >= urgentMinutes;
}

function useElapsed() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(n => n + 1), 1000); return () => clearInterval(t); }, []);
}

export default function KitchenDisplayPage() {
  const settings = loadKdsSettings();
  const t = getKdsTheme(settings.kdsTheme);
  const colsClass = settings.kdsColumns === 'auto'
    ? 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : `grid-cols-${settings.kdsColumns}`;

  const [orders, setOrders]     = useState<KdsOrder[]>([]);
  const [updating, setUpdating] = useState<Set<number>>(new Set());
  const [error, setError]       = useState('');
  const prevIds                 = useRef<Set<number>>(new Set());
  const audio                   = useRef<AudioContext | null>(null);
  const networkUrl              = useNetworkUrl();
  useElapsed();

  const beep = () => {
    if (!settings.kdsSoundEnabled) return;
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
      const hasNew = list.some(o => o.kds_status === 'new' && !prevIds.current.has(o.id));
      if (hasNew) beep();
      prevIds.current = new Set(list.map(o => o.id));
      setOrders(list);
      setError('');
    } catch {
      setError('Cannot reach server');
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, settings.kdsRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [settings.kdsRefreshInterval]);

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

  const visible  = settings.kdsShowServed ? orders : orders.filter(o => o.kds_status !== 'served');
  const newCnt   = orders.filter(o => o.kds_status === 'new').length;
  const prepCnt  = orders.filter(o => o.kds_status === 'preparing').length;
  const readyCnt = orders.filter(o => o.kds_status === 'ready').length;

  const cardBorder: Record<KdsStatus, string> = {
    new:     t.cardBorderNew,
    preparing: t.cardBorderPrep,
    ready:   t.cardBorderReady,
    served:  t.cardBorderServed,
  };
  const badge: Record<KdsStatus, string> = {
    new:      t.badgeNew,
    preparing: t.badgePrep,
    ready:    t.badgeReady,
    served:   t.badgeServed,
  };

  return (
    <div className={`min-h-screen ${t.bg} text-white flex flex-col`}>

      {/* Header */}
      <div className={`${t.header} border-b ${t.headerBorder} px-6 py-3 flex items-center justify-between flex-shrink-0`}>
        <div className="flex items-center gap-4">
          <span className={`font-bold text-xl ${t.text} tracking-tight`}>{settings.kdsDisplayName}</span>
          {error
            ? <span className="text-red-400 text-sm">{error}</span>
            : <span className={`${t.textMuted} text-xs font-mono hidden lg:inline`} title="Open this address on another device to view this screen on the network">
                {networkUrl}/kitchen
              </span>
          }
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
            <span className={t.textMuted}>New</span>
            <span className={`font-bold ${t.text} ml-1`}>{newCnt}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            <span className={t.textMuted}>Preparing</span>
            <span className={`font-bold ${t.text} ml-1`}>{prepCnt}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" />
            <span className={t.textMuted}>Ready</span>
            <span className={`font-bold ${t.text} ml-1`}>{readyCnt}</span>
          </span>
        </div>
      </div>

      {/* Order grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {visible.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full gap-4 ${t.emptyText} select-none`}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
            <p className="text-2xl font-semibold">All clear — no pending orders</p>
          </div>
        ) : (
          <div className={`grid ${colsClass} gap-4`}>
            {visible.map(order => {
              const urgent = order.kds_status === 'new' && isUrgent(order.placed_at, settings.kdsUrgentMinutes);
              return (
                <div key={order.id}
                  className={`rounded-xl border-2 ${cardBorder[order.kds_status]} ${t.cardBg} flex flex-col overflow-hidden
                    ${order.kds_status === 'new' ? `ring-2 ${t.ringNew} ring-offset-2` : ''}
                    ${urgent ? 'animate-pulse' : ''}`}>

                  {/* Card header */}
                  <div className={`px-4 py-3 border-b ${t.divider}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-black text-3xl ${t.text} tabular-nums`}>{order.ticket}</span>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${badge[order.kds_status]}`}>
                          {order.kds_status}
                        </span>
                        <span className={`text-xs tabular-nums ${urgent ? 'text-red-400 font-bold' : t.textMuted}`}>
                          {elapsed(order.placed_at)}
                        </span>
                      </div>
                    </div>
                    {/* Table / order type / customer context — so the kitchen knows who/where this is for */}
                    {(order.table_number || order.order_type || order.customer) && (
                      <div className={`flex items-center flex-wrap gap-2 mt-2 text-xs font-semibold ${t.textMuted}`}>
                        {order.table_number && (
                          <span className={`px-1.5 py-0.5 rounded ${t.badgeNew}`}>Table {order.table_number}</span>
                        )}
                        {order.order_type && (
                          <span>{ORDER_TYPE_LABEL[order.order_type] ?? order.order_type}</span>
                        )}
                        {order.customer && <span>· {order.customer}</span>}
                      </div>
                    )}
                  </div>

                  {/* Items — full description so the chef knows exactly what to prepare */}
                  <div className="flex-1 px-4 py-3 space-y-2.5 min-h-0">
                    {order.items.map((item, i) => (
                      <div key={i}>
                        <div className="flex items-baseline gap-2">
                          <span className={`${t.itemQty} font-bold text-lg tabular-nums w-6 text-right flex-shrink-0`}>
                            {item.qty}×
                          </span>
                          <span className={`${t.text} text-base font-medium leading-tight`}>
                            {item.name}
                            {item.variant && <span className={`${t.textMuted} font-normal`}> — {item.variant}</span>}
                          </span>
                        </div>
                        {item.description && (
                          <p className={`${t.textMuted} text-sm leading-snug pl-8`}>{item.description}</p>
                        )}
                        {item.note && (
                          <p className={`${t.itemQty} text-sm font-semibold leading-snug pl-8`}>⚠ {item.note}</p>
                        )}
                      </div>
                    ))}
                    {order.notes && (
                      <p className={`${t.text} text-sm italic border-t ${t.divider} pt-2 mt-2`}>Note: {order.notes}</p>
                    )}
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
