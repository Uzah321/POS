/**
 * Card Machine / POS Terminal Integration
 *
 * Provides a webhook-based stub that can call any external terminal endpoint.
 * Common use cases:
 *   - Yoco (South Africa) payment terminal via Yoco SDK
 *   - PayAt terminal webhook
 *   - Custom payment gateway bridge
 *
 * The webhook receives the payment request and should respond with:
 *   { success: true, reference: "TXN-..." } on approval
 *   { success: false, message: "Declined" } on decline
 */

export interface CardPaymentRequest {
  amount: number;
  currency: string;
  reference: string;
  cashier?: string;
}

export interface CardPaymentResult {
  success: boolean;
  reference?: string;
  message?: string;
  raw?: unknown;
}

/**
 * Initiate a card payment via configured webhook URL.
 * The endpoint must be same-origin or have CORS headers set.
 */
export async function initiateCardPayment(
  webhookUrl: string,
  request: CardPaymentRequest,
  timeoutMs = 60000
): Promise<CardPaymentResult> {
  if (!webhookUrl) {
    return { success: false, message: 'Card machine webhook URL not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    return {
      success: data.success === true,
      reference: data.reference,
      message: data.message,
      raw: data,
    };
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return { success: false, message: 'Card machine timed out' };
    return { success: false, message: e?.message ?? 'Card machine unreachable' };
  }
}

/**
 * Simulate a card payment (useful for development/demo when no terminal is connected).
 * Always approves after a 2-second delay.
 */
export async function simulateCardPayment(request: CardPaymentRequest): Promise<CardPaymentResult> {
  await new Promise((r) => setTimeout(r, 2000));
  return {
    success: true,
    reference: `SIM-${Date.now()}`,
    message: 'Approved (simulated)',
  };
}
