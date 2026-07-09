import { useState, useEffect } from 'react';
import axios from 'axios';
import { loadKdsSettings, getQueueTheme, TICKET_SIZE } from '../lib/kdsSettings';

interface KdsOrder {
  id: number;
  ticket: string;
  kds_status: 'new' | 'preparing' | 'ready' | 'served';
}

export default function QueueDisplayPage() {
  const settings = loadKdsSettings();
  const th = getQueueTheme(settings.queueTheme);
  const ticketCls = TICKET_SIZE[settings.queueTicketSize];

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
    <div className={`min-h-screen ${th.bg} flex flex-col select-none`}>

      {/* Top bar */}
      <div className={`${th.header} border-b ${th.headerBorder} px-8 py-4 flex items-center justify-between flex-shrink-0`}>
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
            <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2563eb"/>
            <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2" fill="none" opacity="0.5"/>
            <circle cx="18" cy="18" r="4" fill="white"/>
          </svg>
          <span className={`font-bold text-xl tracking-tight ${th.titleText}`}>{settings.queueStoreName}</span>
          {error
            ? <span className={`${th.errorText} text-sm ml-4`}>{error}</span>
            : <span className={`${th.clockText} text-xs font-mono ml-4 hidden lg:inline`}>
                {window.location.protocol}//{window.location.host}/queue
              </span>
          }
        </div>
        {settings.queueShowClock && (
          <span className={`${th.clockText} text-xl tabular-nums font-mono`}>
            {time.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Main display */}
      <div className="flex-1 grid grid-cols-2 gap-0">

        {/* Preparing column */}
        <div className={`border-r ${th.divider} flex flex-col`}>
          <div className={`${th.prepHeaderBg} border-b ${th.prepHeaderBorder} px-8 py-5 flex-shrink-0`}>
            <p className={`${th.prepHeaderLabel} font-bold text-sm uppercase tracking-widest mb-1`}>
              {settings.queuePreparingLabel}
            </p>
            <p className={`${th.prepHeaderSub} text-xs`}>Your order is being prepared</p>
          </div>
          <div className="flex-1 p-6 overflow-y-auto">
            {preparing.length === 0 ? (
              <p className={`${th.emptyText} text-center mt-12 text-lg`}>No orders in progress</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {preparing.map(o => (
                  <div key={o.id}
                    className={`${th.prepCardBg} border-2 ${th.prepCardBorder} rounded-2xl px-6 py-4 min-w-[100px] text-center`}>
                    <span className={`${th.prepTicket} font-black ${ticketCls} tabular-nums`}>{o.ticket}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ready column */}
        <div className="flex flex-col">
          <div className={`${th.readyHeaderBg} border-b ${th.readyHeaderBorder} px-8 py-5 flex-shrink-0`}>
            <p className={`${th.readyHeaderLabel} font-bold text-sm uppercase tracking-widest mb-1`}>
              {settings.queueReadyLabel}
            </p>
            <p className={`${th.readyHeaderSub} text-xs`}>Please collect your order at the counter</p>
          </div>
          <div className="flex-1 p-6 overflow-y-auto">
            {ready.length === 0 ? (
              <p className={`${th.emptyText} text-center mt-12 text-lg`}>No orders ready</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {ready.map(o => (
                  <div key={o.id}
                    className={`${th.readyCardBg} border-2 ${th.readyCardBorder} rounded-2xl px-6 py-4 min-w-[100px] text-center animate-pulse`}>
                    <span className={`${th.readyTicket} font-black ${ticketCls} tabular-nums`}>{o.ticket}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={`${th.footer} border-t ${th.footerBorder} px-8 py-3 flex-shrink-0 text-center`}>
        <p className={`${th.footerText} text-xs`}>{settings.queueFooterMessage}</p>
      </div>
    </div>
  );
}
