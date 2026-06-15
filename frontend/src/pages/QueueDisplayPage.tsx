import { useState, useEffect } from 'react';
import axios from 'axios';

interface KdsOrder {
  id: number;
  ticket: string;
  kds_status: 'new' | 'preparing' | 'ready' | 'served';
}

export default function QueueDisplayPage() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [time, setTime]     = useState(new Date());
  const [error, setError]   = useState('');

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await axios.get('/api/kds/orders');
        setOrders(data.data ?? []);
        setError('');
      } catch { setError('Connecting...'); }
    };
    fetch();
    const t1 = setInterval(fetch, 4000);
    const t2 = setInterval(() => setTime(new Date()), 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  const preparing = orders.filter(o => o.kds_status === 'new' || o.kds_status === 'preparing');
  const ready     = orders.filter(o => o.kds_status === 'ready');

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col select-none">

      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-8 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
            <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2563eb"/>
            <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5"/>
            <circle cx="18" cy="18" r="4" fill="white"/>
          </svg>
          <span className="font-bold text-xl tracking-tight">Order Status</span>
          {error
            ? <span className="text-amber-400 text-sm ml-4">{error}</span>
            : <span className="text-gray-700 text-xs font-mono ml-4 hidden lg:inline">
                {window.location.protocol}//{window.location.host}/queue
              </span>
          }
        </div>
        <span className="text-gray-400 text-xl tabular-nums font-mono">
          {time.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>

      {/* Main display */}
      <div className="flex-1 grid grid-cols-2 gap-0">

        {/* Preparing column */}
        <div className="border-r border-gray-800 flex flex-col">
          <div className="bg-blue-950 border-b border-blue-900 px-8 py-5 flex-shrink-0">
            <p className="text-blue-300 font-bold text-sm uppercase tracking-widest mb-1">Now Preparing</p>
            <p className="text-gray-500 text-xs">Your order is being prepared</p>
          </div>
          <div className="flex-1 p-6 overflow-y-auto">
            {preparing.length === 0 ? (
              <p className="text-gray-700 text-center mt-12 text-lg">No orders in progress</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {preparing.map(o => (
                  <div key={o.id}
                    className="bg-blue-900/40 border-2 border-blue-600 rounded-2xl px-6 py-4 min-w-[100px] text-center">
                    <span className="text-white font-black text-5xl tabular-nums">{o.ticket}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ready column */}
        <div className="flex flex-col">
          <div className="bg-green-950 border-b border-green-900 px-8 py-5 flex-shrink-0">
            <p className="text-green-300 font-bold text-sm uppercase tracking-widest mb-1">Ready for Collection</p>
            <p className="text-gray-500 text-xs">Please collect your order at the counter</p>
          </div>
          <div className="flex-1 p-6 overflow-y-auto">
            {ready.length === 0 ? (
              <p className="text-gray-700 text-center mt-12 text-lg">No orders ready</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {ready.map(o => (
                  <div key={o.id}
                    className="bg-green-900/40 border-2 border-green-500 rounded-2xl px-6 py-4 min-w-[100px] text-center
                      animate-pulse">
                    <span className="text-green-300 font-black text-5xl tabular-nums">{o.ticket}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-900 border-t border-gray-800 px-8 py-3 flex-shrink-0 text-center">
        <p className="text-gray-600 text-xs">Watch this screen — your number will appear when your order is ready</p>
      </div>
    </div>
  );
}
