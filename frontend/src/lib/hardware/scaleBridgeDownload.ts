import bridgeTemplate from './core-scale-bridge.bat?raw';
import { SCALE_BRIDGE_PORT } from './scale';

/**
 * Hands the till a copy of the Core Scale Bridge made for this site — it
 * only serves pages from the web address it was downloaded from, so another
 * website open on the same computer can't use it. CRLF line endings because
 * cmd misreads a batch file with bare LFs (the bundled copy has whichever
 * the build machine checked out).
 */
export function downloadScaleBridge(): void {
  const script = bridgeTemplate
    .replace('__CORE_BRIDGE_PORT__', String(SCALE_BRIDGE_PORT))
    .replace('__CORE_ALLOWED_ORIGIN__', window.location.origin)
    .replace(/\r?\n/g, '\r\n');
  const url = URL.createObjectURL(new Blob([script], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Core-Scale-Bridge.bat';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
