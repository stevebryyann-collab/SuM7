/**
 * OpenTelemetry bootstrap. This module MUST be imported before any other
 * application import (see main.ts) so that auto-instrumentation can patch the
 * http/express/pg/ioredis modules before they are first required.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const SERVICE_VERSION = process.env.npm_package_version ?? "0.1.0";
const DEPLOYMENT_ENVIRONMENT = process.env.NODE_ENV ?? "development";

/** Parse OTEL_EXPORTER_OTLP_HEADERS ("k1=v1,k2=v2") into a header map. */
function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes("="))
    .reduce<Record<string, string>>((acc, pair) => {
      const idx = pair.indexOf("=");
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) acc[key] = value;
      return acc;
    }, {});
}

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces`
    : undefined,
  headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "b2b-wholesale-api",
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    "deployment.environment": DEPLOYMENT_ENVIRONMENT,
  }),
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": { enabled: true },
      "@opentelemetry/instrumentation-express": { enabled: true },
      "@opentelemetry/instrumentation-pg": { enabled: true },
      "@opentelemetry/instrumentation-ioredis": { enabled: true },
      // Disable noisy fs instrumentation.
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

let started = false;

/** Start the tracing SDK. Safe to call once; subsequent calls are no-ops. */
export function startTracing(): void {
  if (started) return;
  sdk.start();
  started = true;
}

/** Flush and shut down tracing (called during graceful shutdown). */
export async function shutdownTracing(): Promise<void> {
  if (!started) return;
  try {
    await sdk.shutdown();
  } catch {
    // Never let tracing shutdown block process exit.
  } finally {
    started = false;
  }
}

// Start immediately on import so instrumentation patches load first.
startTracing();
