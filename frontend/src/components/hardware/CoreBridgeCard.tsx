import { useEffect, useState } from 'react';
import { CheckCircle, Download, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { checkCoreBridge, type CoreBridgeStatus } from '../../lib/hardware/printBridge';
import { downloadCoreBridge } from '../../lib/hardware/scaleBridgeDownload';

// The online system in a browser reaches IP scales, and this computer's
// printers, through the Core Bridge on the till computer (see
// lib/hardware/core-scale-bridge.bat) — this is where the till gets it and
// can see whether it's running. Not shown in the desktop app, which does
// both itself.

const STATUS_LABEL: Record<CoreBridgeStatus, string> = {
  running: 'Running on this computer',
  'not-running': 'Not running',
  'wrong-site': 'Downloaded for another site',
  outdated: 'Older version running',
};

export default function CoreBridgeCard({ use, onRunning }: { use: 'scales' | 'printers'; onRunning?: () => void }) {
  const [status, setStatus] = useState<CoreBridgeStatus | 'checking'>('checking');
  const probe = () => checkCoreBridge(use === 'printers').then((s) => {
    setStatus(s);
    if (s === 'running') onRunning?.();
  });
  const check = () => {
    setStatus('checking');
    void probe();
  };
  useEffect(() => { void probe(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = status === 'running';
  return (
    <div className="border border-gray-100 rounded-lg p-4 mb-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-gray-900">Core Bridge</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            {use === 'printers'
              ? "The online system lists this computer's printers and prints to them through this small helper on the till computer — a website can't do that by itself. The same helper runs IP scales."
              : "The online system reaches IP scales through this small helper on the till computer — a website can't connect to devices in the shop by itself. Only needed for IP / Ethernet scales. The same helper prints to this computer's printers."}
          </p>
        </div>
        {status === 'checking'
          ? <span className="flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={13} className="animate-spin" />Checking…</span>
          : (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {ok ? <CheckCircle size={12} /> : <WifiOff size={12} />}
              {STATUS_LABEL[status]}
            </span>
          )}
      </div>
      {!ok && (
        <ol className="text-xs text-gray-600 list-decimal pl-4 space-y-1">
          <li>On the till computer in the shop, download it and double-click it. If Windows warns about it, choose More info → Run anyway.</li>
          <li>Leave its window open (minimised is fine). To start it with Windows, move the file into the Startup folder: press Win+R, type <span className="font-mono">shell:startup</span> and press Enter.</li>
          <li>
            {use === 'printers' ? 'Press Check again, then Refresh list.' : 'Press Connect on the scale below.'}
            {' '}If the browser asks to let this site access devices on your local network, choose Allow.
          </li>
        </ol>
      )}
      {status === 'wrong-site' && (
        <p className="text-xs text-amber-700">The bridge running here was downloaded from a different web address — download it again from this page, close the old one and start the new one.</p>
      )}
      {status === 'outdated' && (
        <p className="text-xs text-amber-700">This computer is running an older Core Scale Bridge, which can't print. Download the Core Bridge, close the old window, start the new one — and put it in the Startup folder in place of the old file.</p>
      )}
      <div className="flex gap-2 flex-wrap">
        <button onClick={downloadCoreBridge} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
          <Download size={13} />Download Core Bridge
        </button>
        <button onClick={check} disabled={status === 'checking'} className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 text-xs rounded-lg hover:bg-gray-100 disabled:opacity-50">
          <RefreshCw size={13} />Check again
        </button>
      </div>
    </div>
  );
}
