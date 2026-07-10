/**
 * B2B Analytics Event Tracking
 *
 * Typed analytics event system for buyer portal. Pushes to GTM dataLayer if
 * available, otherwise sends to gtag() if GA4 is configured directly.
 *
 * Usage:
 *   import { trackEvent } from '@/lib/analytics';
 *   trackEvent({ event: 'b2b_add_to_cart', variant_id: '123', quantity: 5, ... });
 */

export type B2BAnalyticsEvent =
  | { event: 'b2b_catalog_view'; merchant_id: string; tier_name: string }
  | { event: 'b2b_add_to_cart'; variant_id: string; quantity: number; unit_price: number; tier_name: string }
  | { event: 'b2b_remove_from_cart'; variant_id: string }
  | { event: 'b2b_cart_updated'; item_count: number; subtotal: number }
  | { event: 'b2b_order_review_opened'; item_count: number; subtotal: number }
  | { event: 'b2b_order_placed'; order_id: string; total: number; payment_terms: string; has_discount: boolean }
  | { event: 'b2b_order_failed'; error_code: string }
  | { event: 'b2b_invoice_downloaded'; invoice_id: string }
  | { event: 'b2b_discount_applied'; code: string; discount_amount: number }
  | { event: 'b2b_list_saved'; list_name: string; item_count: number }
  | { event: 'b2b_list_loaded'; list_name: string; item_count: number };

/**
 * Track a B2B analytics event. No-op on server-side render.
 */
export function trackEvent(event: B2BAnalyticsEvent): void {
  if (typeof window === 'undefined') return;

  // Push to GTM dataLayer if available
  if ((window as any).dataLayer) {
    (window as any).dataLayer.push(event);
    return;
  }

  // Push to gtag if available (direct GA4 integration)
  if ((window as any).gtag) {
    const { event: eventName, ...params } = event;
    (window as any).gtag('event', eventName, params);
    return;
  }

  // Neither GTM nor GA4 configured — no-op
}

/**
 * Initialize GTM for a merchant. Call once on buyer portal layout mount.
 * Returns cleanup function to remove the script on unmount.
 */
export function initializeGTM(gtmId: string): () => void {
  if (typeof window === 'undefined') return () => {};
  if ((window as any).dataLayer) return () => {}; // Already initialized

  // Initialize dataLayer
  (window as any).dataLayer = (window as any).dataLayer || [];
  (window as any).dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  // Inject GTM script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${gtmId}`;
  document.head.appendChild(script);

  // Inject noscript iframe for non-JS fallback
  const noscript = document.createElement('noscript');
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.googletagmanager.com/ns.html?id=${gtmId}`;
  iframe.height = '0';
  iframe.width = '0';
  iframe.style.display = 'none';
  iframe.style.visibility = 'hidden';
  noscript.appendChild(iframe);
  document.body.insertBefore(noscript, document.body.firstChild);

  return () => {
    script.remove();
    noscript.remove();
  };
}

/**
 * Initialize GA4 directly (without GTM). Call once on buyer portal layout mount.
 */
export function initializeGA4(measurementId: string): () => void {
  if (typeof window === 'undefined') return () => {};
  if ((window as any).gtag) return () => {}; // Already initialized

  // Initialize gtag
  (window as any).dataLayer = (window as any).dataLayer || [];
  function gtag(...args: any[]) {
    (window as any).dataLayer.push(arguments);
  }
  (window as any).gtag = gtag;
  gtag('js', new Date());
  gtag('config', measurementId);

  // Inject GA4 script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);

  return () => {
    script.remove();
  };
}
