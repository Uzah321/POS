/**
 * The built-in receipt printer of an Android POS handheld, through RawBT.
 *
 * A web page on Android can only print through the system print dialog, and
 * can't reach a handheld's built-in printer directly. The RawBT app (Play
 * Store, ru.a402d.rawbtprinter) can: set up once on the device to use its
 * built-in printer, it takes the receipt's ESC/POS bytes in an intent: link
 * and prints them straight away — no dialog, nothing to choose.
 *
 * Chrome only lets a page open another app soon after a tap: about 5 seconds on
 * Chrome 72+, while older Chrome can lose the tap while the sale is saved. So
 * this watches for Android switching to RawBT; if it doesn't, a Print button
 * comes up and one tap sends the same receipt.
 */
import toast from 'react-hot-toast';

const RAWBT_PACKAGE = 'ru.a402d.rawbtprinter';

function toBase64(data: Uint8Array): string {
  let binary = '';
  // In pieces: String.fromCharCode can't take a whole logo's worth of arguments at once.
  for (let i = 0; i < data.length; i += 0x2000) {
    binary += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + 0x2000)));
  }
  return btoa(binary);
}

/** The link RawBT prints from — the format its own web examples use. */
export function rawbtLink(data: Uint8Array): string {
  return `intent:base64,${toBase64(data)}#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};end;`;
}

/**
 * Whether Android switched away from this page within `ms` — to RawBT, or to
 * the Play Store when RawBT isn't installed. Either takes focus from the page.
 */
function switchedAway(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const away = () => finish(true);
    const onVisibility = () => { if (document.visibilityState === 'hidden') finish(true); };
    const timer = setTimeout(() => finish(false), ms);
    window.addEventListener('blur', away);
    window.addEventListener('pagehide', away);
    document.addEventListener('visibilitychange', onVisibility);
    function finish(result: boolean) {
      clearTimeout(timer);
      window.removeEventListener('blur', away);
      window.removeEventListener('pagehide', away);
      document.removeEventListener('visibilitychange', onVisibility);
      resolve(result);
    }
  });
}

/** Resolves once this page is back in front (RawBT closes itself when done), or after `ms`. */
function backInFront(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => { if (document.visibilityState === 'visible' && document.hasFocus()) finish(); };
    const timer = setTimeout(() => finish(), ms);
    const poll = setInterval(check, 500);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    function finish() {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      resolve();
    }
  });
}

function offerPrintButton(link: string, what: string): void {
  toast((t) => (
    <span className="flex items-center gap-3">
      {what} didn&apos;t go to the printer.
      <button
        type="button"
        // A tap of its own, so Chrome lets it open RawBT.
        onClick={() => { toast.dismiss(t.id); window.location.href = link; }}
        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold flex-shrink-0"
      >
        Print
      </button>
    </span>
  ), { id: `rawbt-${what}`, duration: 30000 });
}

// One job at a time: a second link sent while RawBT is still taking the first
// would cut it off (a receipt and a kitchen ticket can come together).
let queue: Promise<void> = Promise.resolve();

/** Sends ESC/POS bytes to the built-in printer through RawBT. `what` names it if a tap is needed ("The receipt"). */
export function printViaRawbt(data: Uint8Array, what: string): Promise<void> {
  const link = rawbtLink(data);
  const job = queue.then(async () => {
    const away = switchedAway(2500);
    window.location.href = link;
    if (await away) await backInFront(20000);
    else offerPrintButton(link, what);
  });
  queue = job.catch(() => {});
  return job;
}
