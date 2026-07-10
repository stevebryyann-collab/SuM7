# Part 3 of 4 — Merchant Admin Feature Upgrades (Implementation Summary)

**Branch:** `feat/part-3-merchant-admin`
**Verification (CLAUDE.md gate — all green):**
- `pnpm db:generate` → ok
- `pnpm --filter @b2b/api build` → ok
- `pnpm typecheck` → **6/6 successful**
- `pnpm --filter @b2b/web build` → **exit 0, 26/26 routes** (incl. new `/rep`, `/rep/buyer/[buyerId]/orders`)

This part adds the **sales-rep portal**, **order fulfillment tracking + shipping emails**,
**standing-order reorder reminders**, and the **settings analytics-integration tab**. **All
ten tasks are now complete and verified** — including the Task 5 dashboard redesign, the
Tasks 6–9 design-system reskins, and the buyer-portal tracking + reminders UI (see
**SESSION 2 COMPLETION** below).

---

## DELIVERED

### Task 1 — Sales-rep portal (backend) ✅
| File | Purpose |
|---|---|
| `packages/database/migrations/010_sales_rep_features.sql` | `sales_rep` enum value, `sales_rep_sessions` table (+RLS), `orders.rep_session_id` |
| `packages/database/prisma/schema.prisma` | `MerchantUserRole.sales_rep`, `SalesRepSession` model, `Order.repSessionId` + relations |
| `packages/shared/src/types/index.ts` | `MerchantRole` widened with `'sales_rep'` |
| `apps/api/src/auth/guards/merchant-session.guard.ts` | `VALID_ROLES` accepts `sales_rep` |
| `apps/api/src/auth/services/sales-rep.service.ts` | `startImpersonation` / `endImpersonation` / `validateRepSession` / `listBuyers` / `listBuyerOrders` |
| `apps/api/src/auth/guards/sales-rep-session.guard.ts` | `X-Sales-Rep-Session` → buyer principal + `request.salesRepSession`; falls back to `ClerkBuyerGuard` |
| `apps/api/src/sales-rep/sales-rep.controller.ts` | `POST/DELETE /rep/sessions`, `GET /rep/buyers`, `GET /rep/buyers/:id/orders` (MerchantSessionGuard + RolesGuard `sales_rep,admin,owner`) |
| `apps/api/src/sales-rep/sales-rep.module.ts` | module (imports AuthModule) |
| `apps/api/src/auth/auth.module.ts`, `app.module.ts` | provide/export the service + guard; register module |

### Task 2 — Sales-rep portal (frontend) ✅
| File | Purpose |
|---|---|
| `apps/web/src/lib/rep-session.ts` | sessionStorage handle (token + buyer name) — single source of truth |
| `apps/web/src/lib/api/buyer.ts` | `buyerFetch` forwards `X-Sales-Rep-Session` |
| `apps/api/src/main.ts` | CORS allowlist adds `X-Sales-Rep-Session` |
| `apps/web/src/components/merchant/Sidebar.tsx` | role-gated **Sales Rep** nav item (`sales_rep/admin/owner`) |
| `apps/web/src/hooks/useRep.ts` | `useRepBuyers` / `useRepBuyerOrders` / `useStartRepSession` |
| `apps/web/src/app/(merchant)/rep/page.tsx` | buyer list + "Place Order for Buyer" → starts session, navigates to portal |
| `apps/web/src/app/(merchant)/rep/buyer/[buyerId]/orders/page.tsx` | per-buyer order history + breadcrumb |
| `apps/web/src/components/buyer/RepSessionBanner.tsx` | persistent warning banner + End session |
| `apps/web/src/app/(buyer)/layout.tsx` | renders the banner |
| `apps/web/src/lib/dev/mock-api.ts` | demo handlers for `/rep/*` (keeps the no-backend demo working) |

### Task 3 — Order tracking + fulfillment sync (backend) ✅
| File | Purpose |
|---|---|
| `packages/database/migrations/011_order_tracking.sql` | `tracking_number/url`, `fulfillment_service`, `shipped_at`, `estimated_delivery_at` |
| `packages/database/prisma/schema.prisma` | same five fields on `Order` |
| `apps/api/src/queues/queue.module.ts` | `JOB_ORDER_FULFILLMENT_SYNC`, `JOB_ORDER_SHIPPING_EMAIL` |
| `apps/api/src/workers/order-sync.worker.ts` | refactored into a **job-name dispatcher** |
| `apps/api/src/workers/fulfillment-sync.worker.ts` | `FulfillmentSyncService` — writes tracking, marks fulfilled, enqueues email, audits |
| `apps/api/src/workers/shipping-email.worker.ts` | `ShippingEmailService` — sends the shipped email |
| `apps/api/src/email/templates/order-shipped.email.ts` + `email.service.ts` | `sendOrderShippedEmail` |
| `apps/api/src/webhooks/webhooks.controller.ts` | `POST /webhooks/fulfillments/{create,update}` → order queue, priority 3 |
| `apps/api/src/workers/workers.module.ts` | registers the two services |

### Task 4 — Standing orders / reorder reminders (backend) ✅
| File | Purpose |
|---|---|
| `packages/database/migrations/012_standing_orders.sql` | `standing_orders` table |
| `packages/database/prisma/schema.prisma` | `StandingOrder` model + back-relations |
| `apps/api/src/standing-orders/standing-orders.service.ts` | create/list/deactivate + `@Cron('0 8 * * *')` reminder sweep (non-throwing email) |
| `apps/api/src/email/templates/standing-order-reminder.email.ts` + `email.service.ts` | `sendStandingOrderReminderEmail` |
| `apps/api/src/standing-orders/standing-orders.controller.ts` | `GET/POST/DELETE /buyer/standing-orders` (ClerkBuyerGuard) |
| `apps/api/src/standing-orders/standing-orders.module.ts`, `app.module.ts` | module + registration |

### Task 10 — Settings analytics-integration tab ✅
| File | Purpose |
|---|---|
| `apps/web/src/hooks/useSettings.ts` | `useUpdateAnalyticsSettings` → `PATCH /merchants/settings` |
| `apps/web/src/app/(merchant)/settings/page.tsx` | "Analytics Integration" section (GTM + GA4 IDs, event list, Save) |
| `apps/web/src/lib/dev/mock-api.ts` | demo handler for `PATCH /merchants/settings` |

---

## DELIBERATE DEVIATIONS (all defensible)

1. **No `/api/v1` route prefix.** The spec wrote `/api/v1/...`; this codebase has **no global
   prefix** (`main.ts`) and controllers use bare paths (e.g. discount-codes). New controllers
   follow the real convention (`@Controller('rep')`, `buyer/standing-orders`, `merchants/settings`).
2. **Workers are delegated services, not new `@Processor`s.** BullMQ allows exactly one
   `WorkerHost` per queue (see `workers.module.ts`). The spec's two `@Processor('order')` workers
   would collide with `OrderSyncWorker`, so `OrderSyncWorker` now **dispatches by job name** and
   delegates to `FulfillmentSyncService` / `ShippingEmailService` (mirrors `InvoiceWorker` →
   `InvoiceMarkPaidService`). Files keep the spec's names.
3. **Emails are `.ts` HTML renderers, not `.tsx` react-email.** `@react-email/components` is not
   installed (documented in `email/templates/layout.ts`); new templates use the same
   dependency-free `layout`/`button`/`keyValues` helpers as every existing template.
4. **RLS choices.** `sales_rep_sessions` gets RLS (merchant-only access + system bypass — safe).
   `standing_orders` gets **no** RLS, matching Part 2's `shopping_lists`: buyer-portal handlers run
   without a tenant context (the `TenantContextInterceptor` only opens it for merchant requests), so
   RLS would fail those reads closed. Isolation there is app-layer (`where:{buyerId,merchantId}`) +
   the system-context cron.
5. **Rep banner "End session" is client-only.** Per CLAUDE.md ("never mix merchant/buyer auth"),
   the buyer portal must not call the merchant-auth `DELETE /rep/sessions/:token`. Clearing the
   sessionStorage token immediately stops `X-Sales-Rep-Session` forwarding; the server row lapses
   (4h TTL) or is ended from the merchant side.
6. **Settings analytics is write-through (no echo).** There is no merchant GET for `gtmId/ga4Id`
   (only the buyer `portal-config`). The section saves via PATCH; current values are not pre-filled.
7. **`orders.rep_session_id` / `salesRepId` are not written during buyer order creation.** The
   column + relation exist and the rep flow is functional end-to-end; tagging the created order with
   the session id would require threading rep context through the buyer order-create path (which has
   its own RLS handling) and is left as a follow-up.

---

## SESSION 2 COMPLETION (Tasks 5–9 + buyer-portal UI) ✅

All remaining tasks landed; gate re-run green (db:generate, typecheck 6/6, @b2b/api build,
@b2b/web build 28 routes).

| Task | What landed |
|---|---|
| 5 — Dashboard | Full redesign: KPI row, AR-aging + GMV-trend chart row, "Needs Attention" invoices + pending-applications action row. Dedicated skeletons (`KpiCardSkeleton`/`ChartSkeleton`/`InvoiceTableSkeleton`), `EmptyState`, tokens. |
| 6 — Orders | `DataTable` + filter bar (search icon, status, buyer, date range), tokenized `SyncStatusBadge` (CheckCircle2 / Loader2 / AlertTriangle+Tooltip), `buyerId` query support. |
| 7 — Invoices | `InvoiceTable` rebuilt on `DataTable` with a **Days-Overdue** column + **DropdownMenu** actions (View / Resend w/ cooldown / Mark paid / Verify integrity / Void). Page: Download Report, `status`-query → tab, tokenized summary bar. |
| 8 — Buyers | Pending-tab badge + pulse, **Credit Utilization** column (AR ÷ creditLimit, progress bar + tooltip), DropdownMenu row actions incl. owner-only **GDPR export/erase** (wired to `/api/v1/data-export/gdpr/:buyerId`), copy-link icon swap. |
| 9 — Analytics | Header 7D/30D/90D/12M presets, KPI row, full-width GMV trend, **TopBuyersChart** (horizontal bar) + **MonthlyGmvChart** (bar), tabbed detail tables, DropdownMenu export. |
| 3/4 — Buyer UI | API `OrderDetail` now exposes tracking + `containsBackOrder`; new **`/portal/orders/[id]`** (Shipment Status card, back-order notice, reorder prompt) + **`/portal/account`** (Order Reminders). `useStandingOrders` hooks; reorder prompt in `ReviewOrderModal`; Account nav entry; demo mock GDPR + buyer-detail tracking. |

New shared component: **`components/ui/dropdown-menu.tsx`** — dependency-free, portals out of the
`overflow-hidden` `DataTable` so row menus are never clipped.

**Deviation:** GDPR export/erase reuse the existing analytics-controller routes
(`/api/v1/data-export/gdpr/:buyerId`, owner-only) rather than new buyer-controller routes — the
service logic already lived there. The merchant rep `/rep/buyer/[id]/orders` page predates this and
remains the rep-scoped order view.

## MIGRATIONS / ENV

- New migrations: `010_sales_rep_features.sql`, `011_order_tracking.sql`, `012_standing_orders.sql`.
- New Shopify webhook topics to subscribe: `fulfillments/create`, `fulfillments/update`.
- **No new environment variables.**
