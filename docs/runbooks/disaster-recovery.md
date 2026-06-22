# Runbook — Disaster Recovery

**Audience:** on-call / platform engineer. **Goal:** restore service after data loss, a provider
outage, or a bad deploy, while protecting financial integrity (invoices, AR, payments).

---

## Targets

| Metric | Target |
|---|---|
| RPO (max data loss) | ≤ 5 minutes (Supabase PITR) |
| RTO (time to restore) | ≤ 60 minutes for a full DB restore |
| Financial integrity | **Zero** lost or duplicated invoices/payments after recovery |

## Severity & first moves

1. **Declare** severity in the ops channel; assign an Incident Commander.
2. **Stop the bleeding.** If a bad deploy: roll back first (see *Bad deploy*). If data corruption:
   put the API into maintenance (scale the write workers to 0 in Railway) to halt further writes
   before restoring.
3. **Preserve evidence.** Snapshot the current DB state before any destructive restore.
4. **Communicate** status to stakeholders on a regular cadence.

## Component playbooks

### Database (Supabase Postgres) — corruption or loss
1. Identify a safe restore point (just before the incident) via Supabase **Point-in-Time Recovery**.
2. Restore into a **new** project/branch first — never overwrite the live DB blind.
3. Run integrity checks against the restored copy:
   - `invoice_number_seq` continuity — no gaps/duplicates (the `checkSequenceGaps` cron logic).
   - Invoice `pdfSha256` matches stored PDFs (`verifyPdfIntegrity`) for a sample.
   - AR aging totals reconcile against `SUM(total - amount_paid)`.
   - Audit-log immutability trigger present; RLS policies (`003_rls.sql`) applied.
4. Repoint `DATABASE_URL` / `DATABASE_DIRECT_URL` to the restored instance; deploy API.
5. Re-enable write workers; monitor Sentry + queue depth.

### Redis (Railway)
- **Cache (6379, LRU):** ephemeral. On loss, it simply cold-starts; catalog repopulates via the
  stampede-protected fetch. No recovery action beyond restart.
- **Queue (6380, AOF, noeviction):** durable. On loss, restore from AOF. BullMQ jobs are idempotent
  by design (idempotency keys + dedupe on `webhook_events`); replaying is safe. After restore,
  re-run any cron-driven reconciliation (overdue detection, reminders) once.

### S3 (invoice PDFs)
The bucket is the source of truth for rendered PDFs; the DB holds each PDF's SHA-256.
- On object loss, **regenerate** from the source order: `InvoicesService.generateAndStoreInvoice`
  re-renders deterministically and re-stores. Verify the new SHA-256 matches (or update it via the
  audited path) — never hand-edit hashes.
- Confirm bucket policy stays private (SSE-KMS, presigned URLs only) after any restore.

### External providers (Shopify / Stripe / Clerk / Resolve)
All external calls are opossum-breaker-wrapped, so a provider outage trips the breaker and degrades
gracefully rather than cascading. During an outage:
- **Reads** serve from cache where possible.
- **Webhooks** are retried by the provider; our endpoints are idempotent (`webhook_events` dedupe),
  so a backlog drains safely once the provider recovers.
- Do **not** disable signature verification to "catch up" — replay is handled by idempotency.

## Bad deploy (fastest recovery path)
1. **API (Railway):** redeploy the previous known-good image/commit.
2. **Web (Vercel):** instant rollback to the prior production deployment.
3. If the bad deploy included a **migration**, assess whether it is backward-compatible:
   - Additive migration → rolling back code is usually safe.
   - Destructive migration (dropped column/table) → restore the DB to pre-migration PITR, then
     redeploy the matching prior code. Coordinate code + schema versions.
4. Verify health checks, a merchant sign-in, and one financial read before closing.

## Post-incident
- Reconcile financial state: invoice sequence continuity, AR totals, Stripe payment events vs DB.
- Drain and inspect any dead-letter queue entries.
- Write a blameless post-mortem: timeline, root cause, RPO/RTO actually achieved, action items.
- File follow-ups to close gaps the incident exposed (alerting, backups, runbook fixes).
