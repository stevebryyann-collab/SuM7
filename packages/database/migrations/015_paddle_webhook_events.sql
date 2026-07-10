-- Migration 015: Paddle webhook idempotency + ordering ledger
-- Run after: 014_gmv_ledger.sql
-- Apply against DATABASE_DIRECT_URL (port 5432), not the pooler.
--
-- WHY THIS EXISTS
-- BillingController.webhook verifies the Paddle signature and then called
-- handleWebhook directly, with NO persisted event row (unlike Shopify's
-- webhook_events). Paddle delivers at-least-once and does not guarantee ordering,
-- so:
--   • every redelivery re-ran the handler → duplicate audit rows, and a stale,
--     out-of-order subscription.updated could wrongly flip merchants.is_active.
--
-- This table records each Paddle event id EXACTLY ONCE (unique event_id) before
-- processing. A redelivery collides on the unique index and is skipped. Recording
-- occurred_at + the Paddle entity id (subscription/transaction) lets the handler
-- skip applying a subscription state change when a NEWER event for the same
-- entity has already been recorded (ordering guard).
--
-- RLS: NONE. This is a global provider-event dedup table (mirrors
-- idempotency_keys), not merchant-owned. Every statement is idempotent.

CREATE TABLE IF NOT EXISTS paddle_webhook_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         VARCHAR(255) NOT NULL,
  event_type       VARCHAR(100) NOT NULL,
  paddle_entity_id VARCHAR(255),
  occurred_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS paddle_webhook_events_event_id_key
  ON paddle_webhook_events (event_id);

CREATE INDEX IF NOT EXISTS paddle_webhook_events_entity_occurred_idx
  ON paddle_webhook_events (paddle_entity_id, occurred_at DESC);
