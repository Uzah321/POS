/**
 * saleRef — the till's own name for a sale (sent as `client_ref`).
 *
 * The server saves a sale once per name: a resend whose first reply got lost
 * (dropped connection, or the till stopped waiting and queued it — see
 * offlineMutation.ts) gets back the sale already saved instead of making a
 * second one. Empire Meats' till once saved one $2 label 12 times that way.
 *
 * A retry of the same cart after an error keeps its name, so a sale that
 * went through without the till hearing about it isn't charged twice. Once a
 * sale is done (saved, or queued to send later) the next one gets a new name,
 * even for an identical basket — that's a second customer, not a resend.
 */

/** A random v4 UUID. crypto.randomUUID needs a secure page; a till opened on a LAN address over plain http isn't one. */
export function newSaleRef(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Keeps one name per cart until the sale is done. Hold one per till screen (useRef). */
export class SaleRefKeeper {
  private last: { ref: string; sig: string } | null = null;

  /** The name for this payload: the same as last time if the cart is unchanged since an attempt that didn't finish. */
  refFor(payload: object): string {
    const sig = JSON.stringify(payload);
    if (this.last?.sig !== sig) this.last = { ref: newSaleRef(), sig };
    return this.last.ref;
  }

  /** The sale is saved or queued — the next one, even an identical basket, is a new sale. */
  done(): void {
    this.last = null;
  }
}
