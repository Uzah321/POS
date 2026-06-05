/**
 * CustomerDisplayPage — shown on a second screen facing the customer.
 * Receives live cart data via BroadcastChannel from the POS page.
 * Navigate to /customer-display (no auth required).
 */

import { useEffect, useState } from 'react';
import { CHANNEL_NAME } from '../lib/hardware/customerDisplay';
import type { CartDisplayData } from '../lib/hardware/customerDisplay';

export default function CustomerDisplayPage() {
  const [data, setData] = useState<CartDisplayData>({ type: 'idle' });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.onmessage = (e: MessageEvent<CartDisplayData>) => setData(e.data);
    return () => ch.close();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fmt = (n: number) => `${data.currency ?? '$'}${Number(n).toFixed(2)}`;

  if (data.type === 'thankyou') {
    return (
      <div className="min-h-screen bg-blue-700 flex flex-col items-center justify-center text-white gap-6">
        <div className="text-8xl">🎉</div>
        <h1 className="text-5xl font-bold">Thank You!</h1>
        <p className="text-2xl opacity-80">Please come again</p>
        <p className="text-lg opacity-60 mt-4">{data.storeName}</p>
      </div>
    );
  }

  if (data.type === 'idle' || !data.items?.length) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white gap-6">
        <div className="text-6xl font-bold text-blue-400">
          {data.storeName ?? 'NexaPOS'}
        </div>
        <p className="text-xl opacity-50">Welcome</p>
        <p className="text-2xl opacity-30 mt-8">{time.toLocaleTimeString()}</p>
      </div>
    );
  }

  // Active cart
  const items = data.items ?? [];
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-blue-700 px-8 py-4 flex items-center justify-between">
        <span className="text-2xl font-bold">{data.storeName ?? 'NexaPOS'}</span>
        <span className="text-lg opacity-70">{time.toLocaleTimeString()}</span>
      </div>

      {/* Items table */}
      <div className="flex-1 p-8 overflow-auto">
        <table className="w-full text-lg">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left pb-3">Item</th>
              <th className="text-center pb-3 w-16">Qty</th>
              <th className="text-right pb-3 w-32">Price</th>
              <th className="text-right pb-3 w-32">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-gray-800">
                <td className="py-3">{item.name}</td>
                <td className="py-3 text-center text-gray-300">{item.qty}</td>
                <td className="py-3 text-right text-gray-300">{fmt(item.price)}</td>
                <td className="py-3 text-right">{fmt(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals footer */}
      <div className="bg-gray-800 px-8 py-6 border-t border-gray-700">
        <div className="max-w-sm ml-auto space-y-2 text-lg">
          {(data.discount ?? 0) > 0 && (
            <div className="flex justify-between text-gray-400">
              <span>Discount</span>
              <span>-{fmt(data.discount!)}</span>
            </div>
          )}
          {(data.tax ?? 0) > 0 && (
            <div className="flex justify-between text-gray-400">
              <span>Tax</span>
              <span>{fmt(data.tax!)}</span>
            </div>
          )}
          <div className="flex justify-between text-3xl font-bold text-blue-400 pt-2 border-t border-gray-600">
            <span>TOTAL</span>
            <span>{fmt(data.total ?? 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
