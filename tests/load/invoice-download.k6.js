import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Invoice-download load test.
 *
 * Buyers fetching presigned PDF URLs. Exercises the ownership check + S3
 * presign path (and the atomic first-view stamp). We request the presigned URL
 * from the API; following the URL to S3 itself is out of scope (it bypasses our
 * infra), so this measures the API surface only.
 *
 * Run:
 *   k6 run -e BASE_URL=https://api.example.com -e BUYER_TOKEN=clerk_jwt \
 *          -e MERCHANT_DOMAIN=shop.myshopify.com \
 *          -e INVOICE_IDS=uuid1,uuid2,uuid3 tests/load/invoice-download.k6.js
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const BUYER_TOKEN = __ENV.BUYER_TOKEN || '';
const MERCHANT_DOMAIN = __ENV.MERCHANT_DOMAIN || 'demo.myshopify.com';
const INVOICE_IDS = (__ENV.INVOICE_IDS || '00000000-0000-4000-8000-000000000000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const presignLatency = new Trend('presign_latency', true);
const presignErrors = new Rate('presign_errors');

export const options = {
  scenarios: {
    download: {
      executor: 'constant-vus',
      vus: 40,
      duration: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<600', 'p(99)<1200'],
    presign_errors: ['rate<0.01'],
  },
};

export default function () {
  const id = INVOICE_IDS[Math.floor(Math.random() * INVOICE_IDS.length)];
  const res = http.get(`${BASE_URL}/buyer/invoices/${id}/download`, {
    headers: {
      Authorization: `Bearer ${BUYER_TOKEN}`,
      Cookie: `__merchant_domain=${MERCHANT_DOMAIN}`,
    },
  });

  presignLatency.add(res.timings.duration);
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'returns presigned url': (r) => {
      try {
        return typeof r.json('url') === 'string' && r.json('url').startsWith('http');
      } catch {
        return false;
      }
    },
  });
  presignErrors.add(!ok);

  sleep(1);
}
