// Browser side of Cashfree checkout. The backend creates the order and returns
// a short-lived paymentSessionId; this opens Cashfree's hosted checkout for it.
// Docs: https://www.cashfree.com/docs/payments/online/web/redirect

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

declare global {
  interface Window {
    Cashfree?: (opts: { mode: 'sandbox' | 'production' }) => {
      checkout: (opts: { paymentSessionId: string; redirectTarget?: string }) => Promise<any>;
    };
  }
}

function loadSdk(): Promise<void> {
  if (window.Cashfree) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("We couldn't open the payment window. Check your internet connection and try again."));
    document.body.appendChild(s);
  });
}

/**
 * Opens checkout as a popup. Resolves when the popup closes:
 * - `redirected`: the payment method left the page (e.g. in-app browsers);
 *   the user comes back to the order's return URL with ?order_id=...
 * - `closedMessage`: set when the user closed the popup or it errored.
 * Never trust this result for the payment status — ask the backend.
 */
export async function openCashfreeCheckout(order: {
  paymentSessionId: string;
  environment: 'sandbox' | 'production';
}): Promise<{ redirected: boolean; closedMessage?: string; paymentMessage?: string }> {
  await loadSdk();
  const cashfree = window.Cashfree!({ mode: order.environment });
  const result = await cashfree.checkout({
    paymentSessionId: order.paymentSessionId,
    redirectTarget: '_modal',
  });
  return {
    redirected: Boolean(result?.redirect),
    closedMessage: result?.error ? result.error.message || 'Checkout closed' : undefined,
    paymentMessage: result?.paymentDetails?.paymentMessage,
  };
}
