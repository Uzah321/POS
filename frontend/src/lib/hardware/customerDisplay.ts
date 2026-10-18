/**
 * Customer Display Service — BroadcastChannel
 *
 * Opens a second browser window showing the live cart to the customer.
 * The POS page posts cart updates via BroadcastChannel; the display
 * page listens and renders them. The same updates also drive a USB pole
 * display, when one is connected (poleDisplay.ts).
 *
 * Open the display:  openCustomerDisplay()
 * Push cart state:   broadcastCart(data)
 * Close display:     closeCustomerDisplay()
 */

import { showOnPoleDisplay } from './poleDisplay';

export const CHANNEL_NAME = 'customer-display';

/** Amounts are in the base currency (USD), as the cart keeps them — except `change`. */
export interface CartDisplayData {
  type: 'cart' | 'idle' | 'thankyou';
  storeName?: string;
  currency?: string;
  items?: { name: string; qty: number; price: number; total: number }[];
  subtotal?: number;
  tax?: number;
  discount?: number;
  total?: number;
  /** 'thankyou' after a cash sale: the change handed back, in the currency the customer paid in (as on the receipt). */
  change?: number;
}

let displayWindow: Window | null = null;
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel {
  if (!channel || channel.name !== CHANNEL_NAME) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

export function openCustomerDisplay(): void {
  const url = `${window.location.origin}/customer-display`;
  if (displayWindow && !displayWindow.closed) {
    displayWindow.focus();
    return;
  }
  displayWindow = window.open(url, 'customer-display', 'width=800,height=600,menubar=0,toolbar=0,status=0');
}

export function closeCustomerDisplay(): void {
  if (displayWindow && !displayWindow.closed) displayWindow.close();
  displayWindow = null;
}

export function broadcastCart(data: CartDisplayData): void {
  try {
    getChannel().postMessage(data);
  } catch {
    // BroadcastChannel may not be available in all environments
  }
  showOnPoleDisplay(data);
}

export function isDisplayOpen(): boolean {
  return !!displayWindow && !displayWindow.closed;
}
