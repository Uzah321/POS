import { SCALE_BRIDGE_PORT } from './scale';

/**
 * Printers through the Core Bridge (core-scale-bridge.bat) — how the online
 * system in a browser reaches the printers Windows has installed on the till
 * computer, which a web page can't list or print to silently by itself. The
 * same small program relays IP scales. One WebSocket per request: /printers
 * answers {"type":"printers"}; /print?printer= takes the job (the printer's
 * own ESC/POS bytes) as one binary message and answers {"type":"printed"}.
 * Either answers {"type":"error"} instead when it can't.
 */
const BRIDGE_URL = `ws://127.0.0.1:${SCALE_BRIDGE_PORT}`;

const BRIDGE_DOWN =
  "The Core Bridge isn't running on this computer (or the browser blocked it) — start it, see Hardware → Receipt Printer.";
const BRIDGE_OLD =
  'This Core Bridge is an older version without printers — download it again from Hardware → Receipt Printer, close the old one and start the new one.';

export interface BridgePrinter {
  name: string;
  port: string;
  isDefault: boolean;
  offline: boolean;
}

function ask(path: string, body: Uint8Array | null, answer: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try { ws = new WebSocket(BRIDGE_URL + path); } catch { reject(new Error(BRIDGE_DOWN)); return; }
    let opened = false;
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("The Core Bridge didn't answer in time"))), timeoutMs);
    ws.onopen = () => {
      opened = true;
      if (body) ws.send(body as Uint8Array<ArrayBuffer>); // the builders' plain byte arrays, never shared memory
    };
    ws.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg.type === answer) finish(() => resolve(msg));
      else if (msg.type === 'error') {
        const message = String(msg.message ?? 'The Core Bridge refused');
        finish(() => reject(new Error(message === 'Unknown request.' ? BRIDGE_OLD : message)));
      }
    };
    ws.onclose = () => finish(() => reject(new Error(opened ? 'The Core Bridge closed the connection' : BRIDGE_DOWN)));
  });
}

export type CoreBridgeStatus = 'running' | 'not-running' | 'wrong-site' | 'outdated';

/** Whether the bridge is up on this computer, downloaded for this site, and (if asked) new enough to print. */
export async function checkCoreBridge(needPrinters: boolean): Promise<CoreBridgeStatus> {
  try {
    const hello = await ask('/ping', null, 'hello', 2500);
    if (hello.allowed === false) return 'wrong-site';
    return needPrinters && hello.printers !== true ? 'outdated' : 'running';
  } catch {
    return 'not-running';
  }
}

/** Every printer Windows has installed on this computer. */
export async function bridgePrinters(): Promise<BridgePrinter[]> {
  const msg = await ask('/printers', null, 'printers', 8000);
  return Array.isArray(msg.printers) ? msg.printers : [];
}

/** Sends a job, as-is, to a printer Windows has installed. */
export async function bridgePrint(printer: string, job: Uint8Array): Promise<void> {
  await ask(`/print?printer=${encodeURIComponent(printer)}`, job, 'printed', 30000);
}
