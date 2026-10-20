import qz from 'qz-tray';
import api from '../axios';

/**
 * QZ Tray — a program installed on the till computer that lets a web page
 * list Windows' printers and print to them without a dialog. It only prints
 * silently for requests signed with a certificate it trusts: the server
 * hands over its site certificate and signs each request (backend
 * App\Support\QzTraySigning), and the till installs the server's
 * override.crt in QZ Tray's folder once, so QZ Tray trusts them.
 */
const QZ_DOWN = "QZ Tray isn't running on this computer — start it (see Hardware → Receipt Printer).";

let setUp = false;
function setUpSigning(): void {
  if (setUp) return;
  setUp = true;
  qz.security.setCertificatePromise((resolve, reject) => {
    api.get('/qz-tray/certificate', { responseType: 'text' }).then((r) => resolve(String(r.data))).catch(reject);
  });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    api.post('/qz-tray/sign', { request: toSign }).then((r) => resolve(r.data?.data?.signature ?? '')).catch(reject);
  });
}

let connecting: Promise<void> | null = null;

/** One connection for the page, opened when first needed. */
async function connected(): Promise<void> {
  setUpSigning();
  if (qz.websocket.isActive()) return;
  connecting ??= qz.websocket.connect({ retries: 1, delay: 1 }).finally(() => { connecting = null; });
  try {
    await connecting;
  } catch {
    if (!qz.websocket.isActive()) throw new Error(QZ_DOWN);
  }
}

/** QZ Tray's version when it's running here, or null. */
export async function checkQzTray(): Promise<string | null> {
  try {
    await connected();
    return await qz.api.getVersion();
  } catch {
    return null;
  }
}

/** Every printer Windows has installed on this computer. */
export async function qzPrinters(): Promise<Array<{ name: string; isDefault: boolean }>> {
  await connected();
  const details = await qz.printers.details().catch(() => null);
  if (Array.isArray(details)) return details.map((d) => ({ name: d.name, isDefault: !!d.default }));
  const [found, fallbackDefault] = await Promise.all([qz.printers.find(), qz.printers.getDefault().catch(() => '')]);
  return (Array.isArray(found) ? found : [found]).map((name) => ({ name, isDefault: name === fallbackDefault }));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Sends a job, as-is (the printer's own ESC/POS bytes), to a printer Windows has installed. */
export async function qzPrintRaw(printer: string, job: Uint8Array): Promise<void> {
  await connected();
  await qz.print(qz.configs.create(printer), [{ type: 'raw', format: 'command', flavor: 'base64', data: toBase64(job) }]);
}

/** Saves the certificate a till installs in QZ Tray's folder as override.crt. */
export async function downloadQzCertificate(): Promise<void> {
  const r = await api.get('/qz-tray/override-certificate', { responseType: 'blob' });
  const url = URL.createObjectURL(r.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'override.crt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
