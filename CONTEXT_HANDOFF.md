# CONTEXT HANDOFF — Design System, PART 1 of 4 (Foundation)

**Date:** 2026-06-28
**Scope of this session:** Implemented **PART 1 OF 4 — DESIGN SYSTEM FOUNDATION**
(token system + redesign of every shared/foundation UI component, plus wiring the
merchant shell and all merchant pages onto the new `PageLayout`).
**Verification:** `pnpm typecheck` → **6/6 successful**. `pnpm --filter=@b2b/web build`
→ **exit 0, 22/22 routes** compiled + type-checked + linted. ✅

> The previous `CONTEXT_HANDOFF*.md` files (SESSION6/7, FINAL, FINAL_UPDATED) were
> intentionally deleted and replaced by this single handoff, per the build prompt.

---

## WHAT THIS PROMPT DELIVERED (13 tasks, all complete)

A token-driven design system. **No component uses a hardcoded hex, an arbitrary
Tailwind value, or a shadow outside the token scale.** Tokens live in
`tailwind.config.ts` + CSS custom properties in `globals.css`.

1. **Tailwind tokens** — colors (`bg/surface/border/border-strong`, `text.*`,
   `accent.*`, `success/warning/danger/neutral`, `aging.*`), `fontSize` scale
   (incl. `2xs` 11px + `kpi` 28px), soft `boxShadow` (sm/md/lg/inner-sm),
   `borderRadius`, `transitionDuration` (fast/base/slow), Inter + JetBrains Mono.
2. **globals.css** — Google-Fonts `@import`, `:root` CSS vars mirroring the
   tokens (consumed by the Toaster), `.tabular-nums` → JetBrains Mono + `tnum`.
3. **Button** — `primary/secondary/ghost/destructive` (+ `default` alias, `link`)
   on tokens, color-only transitions (no transforms), **`LoadingButton`**.
4. **StatusBadge** — solid-fill bordered 11px uppercase, per-status token map.
5. **DataTable** — styled wrapper set; `align="right"` auto-applies `.tabular-nums`.
6. **DashboardKpiCard** — 28px `kpi` value, change row, pulse badge, no shadow.
7. **Sidebar** — fixed 220px, nav groups, active left-accent line, pending-buyers
   pulse badge (via `usePendingBuyersCount`).
8. **Input / Select / Textarea** — token border + accent focus ring; **`FormField`**.
9. **LoadingSkeleton** — content-aware named skeletons (Kpi/TableRow/Invoice/Buyer/
   Chart/PageHeader) + original weighted `LoadingSkeleton` kept.
10. **EmptyState** — base + named variants (Dashboard/BuyerList/InvoiceList/OrderList/
    BuyerCatalog), copyable application-link field.
11. **ConfirmDialog** — token surface, `shadow-lg rounded-xl`, `children` slot,
    `LoadingButton` confirm.
12. **toasts** — typed `toast.{success,error,warning,info,loading,promise,dismiss}`
    with token-colored icons; Toaster moved to **bottom-right** + token style.
13. **PageLayout** — centered 1200px column + title/subtitle/action header; wired
    into the merchant layout (sidebar offset) and **all 13 merchant pages**.

---

## FILE SUMMARY — File Path · What Changed · Key Exports

| File Path | What Changed | Key Exports |
|---|---|---|
| `apps/web/tailwind.config.ts` | Full token system added to `theme.extend` (legacy keys kept for back-compat) | _(config)_ |
| `apps/web/src/app/globals.css` | Fonts `@import`, `:root` token vars, `.tabular-nums` → mono+tnum | _(styles)_ |
| `apps/web/src/app/layout.tsx` | Fonts `preconnect`, `<body className="font-sans antialiased">` | `RootLayout` |
| `apps/web/src/components/ui/button.tsx` | Token variants, color-only transitions | `Button`, `LoadingButton`, `buttonVariants` |
| `apps/web/src/components/ui/input.tsx` | Token styles + `error` prop | `Input` |
| `apps/web/src/components/ui/textarea.tsx` | Token styles + `error` prop | `Textarea` |
| `apps/web/src/components/ui/select.tsx` | Token trigger/content/item | `Select*` |
| `apps/web/src/components/shared/StatusBadge.tsx` | Per-status token map + `variant` prop | `StatusBadge` |
| `apps/web/src/components/shared/DataTable.tsx` | **NEW** styled table wrapper | `DataTable`, `DataTableHeader/HeaderCell/Body/Row/Cell/Empty` |
| `apps/web/src/components/shared/FormField.tsx` | **NEW** label/error/hint wrapper | `FormField` |
| `apps/web/src/components/shared/LoadingSkeleton.tsx` | Named content-aware skeletons added | `LoadingSkeleton`, `KpiCardSkeleton`, `TableRowSkeleton`, `InvoiceTableSkeleton`, `BuyerTableSkeleton`, `ChartSkeleton`, `PageHeaderSkeleton`, `SkeletonBar` |
| `apps/web/src/components/shared/EmptyState.tsx` | **NEW** empty states | `EmptyState`, `EmptyDashboard/BuyerList/InvoiceList/OrderList/BuyerCatalog` |
| `apps/web/src/components/shared/ConfirmDialog.tsx` | Token redesign + `children` + `LoadingButton` | `ConfirmDialog` |
| `apps/web/src/components/shared/toasts.tsx` | **NEW** typed toast helpers (`.tsx`, not `.ts`) | `toast` |
| `apps/web/src/components/merchant/DashboardKpiCard.tsx` | `valuePrefix`/`danger` added; `subLabel`/`tone` kept | `DashboardKpiCard` |
| `apps/web/src/components/merchant/Sidebar.tsx` | **NEW** fixed 220px sidebar | `Sidebar` |
| `apps/web/src/components/merchant/PageLayout.tsx` | **NEW** page wrapper + container | `PageLayout`, `PageContainer` |
| `apps/web/src/components/providers/QueryProvider.tsx` | Toaster → bottom-right + token style | `QueryProvider` |
| `apps/web/src/hooks/useBuyers.ts` | Added pending-count poller (60s) | `usePendingBuyersCount` |
| `apps/web/src/app/(merchant)/layout.tsx` | `Sidebar` + `pl-[220px]` offset; container removed (PageLayout owns spacing) | `MerchantLayout` |
| `apps/web/src/app/(merchant)/{dashboard,buyers,pricing,orders,invoices,analytics,settings}/page.tsx` | Converted to `PageLayout` | _(pages)_ |
| `apps/web/src/app/(merchant)/{invoices/[id],orders/[id],pricing/[id],invoices/ar-aging,settings/billing,settings/team}/page.tsx` | Wrapped in `PageLayout`/`PageContainer` | _(pages)_ |

---

## DELIBERATE DEVIATIONS FROM THE LITERAL PROMPT (all defensible)

1. **globals.css path** — prompt said `src/styles/globals.css`; the real file is
   `src/app/globals.css`. Edited the real one (a new file at the other path would
   be dead).
2. **`toasts.tsx` not `.ts`** — the icon helpers are JSX; a `.ts` file cannot hold JSX.
3. **DataTable row hover** — prompt body said `hover:bg-[#F9F9FB]` (arbitrary hex),
   but the prompt's own checklist + CLAUDE.md say *tokens only, no hardcoded hex*.
   Used `hover:bg-neutral-bg`.
4. **No `providers.tsx`** — the Toaster host is `QueryProvider.tsx`; updated there.
5. **Back-compat shims** — `Button` keeps `default`(=secondary)+`link`;
   `DashboardKpiCard` keeps `subLabel`+`tone`; `StatusBadge` keeps extra statuses.
   These prevent regressions in already-shipped callers.
6. **`usePendingBuyersCount`** reuses the real `/buyers/applications?status=pending`
   endpoint and counts client-side. The prompt's `/buyers?status=pending&count=true`
   route does not exist and would throw in the demo mock. 60s `refetchInterval` kept.
7. **Sidebar wiring** — replaced `MerchantNav` in the layout; **kept `MerchantTopbar`**
   because the spec'd sidebar has no sign-out. `MerchantNav.tsx` is now unused (left
   on disk; safe to delete).
8. **PageLayout extras** — added `headerActions?: ReactNode` and exported
   `PageContainer` so pages with rich header actions (filters, ExportMenu, copy-link)
   and bespoke detail-page headers keep working.

---

## NOT DONE / NEXT SESSION

- **PART 2, 3, 4** of the design-system rollout remain (this was PART 1 of 4). The
  PART 1 prompt text was saved to `/home/claude/OPUS_PROMPTS_PART_1_OF_4.md`; PARTS
  2–4 will arrive as their own prompts.
- **Page-body utility colors** still use Tailwind gray/red default scales
  (`text-gray-500`, `text-red-700`, `bg-gray-50`, …) and a few bespoke pills
  (billing `PlanStatusBadge`, settings toggle, buyers/invoices count chips). These
  render fine but are not yet tokenized — migrate incrementally to `text-text-*`,
  `text-danger`, `bg-neutral-bg`, `StatusBadge`, etc.
- **`toast` helper adoption** — existing code still imports `toast` from `sonner`
  directly; swap to `@/components/shared/toasts` over time.
- **EmptyState adoption** — named variants exist but pages still use inline empty
  states (e.g. pricing). Swap when convenient.
- **`MerchantNav.tsx`** — dead file; delete in a cleanup pass.

## VERIFY (CLAUDE.md gate — both pass now)
```
pnpm typecheck                      # 6/6 successful
pnpm --filter=@b2b/web build        # exit 0, 22/22 routes
```

## ARCHITECTURE GUARDRAILS (unchanged, still enforced)
Split auth (NextAuth+Shopify for merchants / Clerk for buyers), unified buyer
accounts, RLS + `where:{merchantId}`, Decimal.js money, Serializable financial
writes, opossum breakers, cursor pagination. **None touched by PART 1** — this was
purely the web design layer.
