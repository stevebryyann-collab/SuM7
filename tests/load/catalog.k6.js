import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Buyer catalog read load test.
 *
 * Models the hottest read path in the portal: buyers browsing the tier-priced
 * catalog. Exercises the API's Redis cache + stampede protection. Cursor
 * pagination is followed for a realistic "scroll" pattern.
 *
 * Run:
 *   k6 run -e BASE_URL=https://api.example.com -e BUYER_TOKEN=clerk_jwt \
 *          -e MERCHANT_DOMAIN=shop.myshopify.com tests/load/catalog.k6.js
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const BUYER_TOKEN = __ENV.BUYER_TOKEN || '';
const MERCHANT_DOMAIN = __ENV.MERCHANT_DOMAIN || 'demo.myshopify.com';

const catalogLatency = new Trend('catalog_latency', true);
const catalogErrors = new Rate('catalog_errors');

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 150 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    // The cache makes this path fast; hold it to a tight SLO.
    http_req_duration: ['p(95)<400', 'p(99)<800'],
    catalog_errors: ['rate<0.01'],
  },
};

function headers() {
  return {
    Authorization: `Bearer ${BUYER_TOKEN}`,
    // The API guard reads the merchant tenant from this cookie (App Proxy).
    Cookie: `__merchant_domain=${MERCHANT_DOMAIN}`,
  };
}

export default function () {
  let cursor = null;
  // Page through up to 3 catalog pages per iteration (a typical browse session).
  for (let page = 0; page < 3; page += 1) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res = http.get(`${BASE_URL}/buyer/catalog${qs}`, { headers: headers() });

    catalogLatency.add(res.timings.duration);
    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'has products array': (r) => {
        try {
          return Array.isArray(r.json('products'));
        } catch {
          return false;
        }
      },
    });
    catalogErrors.add(!ok);

    if (!ok) break;
    const hasNext = res.json('pageInfo.hasNextPage');
    cursor = res.json('pageInfo.endCursor');
    if (!hasNext || !cursor) break;
    sleep(0.5);
  }
  sleep(1);
}
