import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

/**
 * Order-creation load test.
 *
 * The most expensive write path: server-side pricing, optimistic credit lock,
 * Shopify draft compensation, and a SERIALIZABLE persist. Each request carries a
 * unique Idempotency-Key (required by the API). This tests throughput under the
 * write-contention model, not just read caching.
 *
 * Run:
 *   k6 run -e BASE_URL=https://api.example.com -e BUYER_TOKEN=clerk_jwt \
 *          -e MERCHANT_DOMAIN=shop.myshopify.com -e VARIANT_ID=gid://... \
 *          tests/load/order-creation.k6.js
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const BUYER_TOKEN = __ENV.BUYER_TOKEN || '';
const MERCHANT_DOMAIN = __ENV.MERCHANT_DOMAIN || 'demo.myshopify.com';
const VARIANT_ID = __ENV.VARIANT_ID || 'gid://shopify/ProductVariant/1';

const orderLatency = new Trend('order_latency', true);
const orderErrors = new Rate('order_errors');

export const options = {
  scenarios: {
    place_orders: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: {
    // Writes are heavier than reads; allow more headroom but keep a ceiling.
    http_req_duration: ['p(95)<2500', 'p(99)<5000'],
    order_errors: ['rate<0.02'],
  },
};

export default function () {
  const payload = JSON.stringify({
    lines: [{ shopifyVariantId: VARIANT_ID, quantity: Math.floor(Math.random() * 20) + 1 }],
  });

  const res = http.post(`${BASE_URL}/buyer/orders`, payload, {
    headers: {
      Authorization: `Bearer ${BUYER_TOKEN}`,
      Cookie: `__merchant_domain=${MERCHANT_DOMAIN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': uuidv4(),
    },
  });

  orderLatency.add(res.timings.duration);
  const ok = check(res, {
    'status is 201': (r) => r.status === 201,
    'returns orderId': (r) => {
      try {
        return typeof r.json('orderId') === 'string';
      } catch {
        return false;
      }
    },
  });
  orderErrors.add(!ok);

  sleep(2);
}
