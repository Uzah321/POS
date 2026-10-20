import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, Download, ExternalLink, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { checkQzTray, downloadQzCertificate } from '../../lib/hardware/qzTray';

// Hardware → Receipt / Kitchen Printer in a browser, printing through QZ
// Tray: whether it's running on this computer, and the one-off setup that
// lets it print without asking (this site's certificate in its folder).

export default function QzTrayCard({ onRunning }: { onRunning?: () => void }) {
  const [version, setVersion] = useState<string | null | 'checking'>('checking');
  const probe = () => checkQzTray().then((v) => {
    setVersion(v);
    if (v) onRunning?.();
  });
  const check = () => {
    setVersion('checking');
    void probe();
  };
  useEffect(() => { void probe(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => downloadQzCertificate().catch(() => toast.error("Couldn't download the certificate"));
  const running = typeof version === 'string' && version !== 'checking';
  const site = window.location.hostname;

  return (
    <div className="border border-gray-100 rounded-lg p-4 mb-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-gray-900">QZ Tray</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            A free program on the till computer that lets this website list its printers and print to them without a dialog.
          </p>
        </div>
        {version === 'checking'
          ? <span className="flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={13} className="animate-spin" />Checking…</span>
          : (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${running ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {running ? <CheckCircle size={12} /> : <WifiOff size={12} />}
              {running ? `QZ Tray ${version} running` : 'Not running'}
            </span>
          )}
      </div>
      <ol className="text-xs text-gray-600 list-decimal pl-4 space-y-1.5">
        <li>
          Install QZ Tray on this computer from{' '}
          <a href="https://qz.io/download/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">qz.io/download<ExternalLink size={11} /></a>
          {' '}— it starts with Windows after that.
        </li>
        <li>
          Once per computer, so it prints without asking: download this site's certificate and save it in{' '}
          <span className="font-mono">C:\Program Files\QZ Tray</span> as <span className="font-mono">override.crt</span> (Windows asks an administrator to allow it).
          Then restart QZ Tray: right-click its icon by the clock → Exit, and start QZ Tray again.
        </li>
        <li>
          Press Check again, then Refresh list. If QZ Tray asks whether to allow <b>{site}</b>, tick <b>Remember this decision</b> and click <b>Allow</b> —
          from then on it prints without asking.
        </li>
      </ol>
      <p className="text-xs text-gray-400">Without the certificate QZ Tray still prints, but asks every time.</p>
      <div className="flex gap-2 flex-wrap">
        <button onClick={download} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
          <Download size={13} />Download certificate (override.crt)
        </button>
        <button onClick={check} disabled={version === 'checking'} className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 text-xs rounded-lg hover:bg-gray-100 disabled:opacity-50">
          <RefreshCw size={13} />Check again
        </button>
      </div>
    </div>
  );
}
