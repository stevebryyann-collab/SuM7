# Part 2 of 4: Buyer-Facing Features Implementation Summary

## Overview
Implemented buyer-facing feature upgrades for the B2B wholesale portal, including inventory visibility, discount codes, shopping lists, back-order support, and GA4 analytics tracking.

## Database Changes

### Migrations
- **008_buyer_features.sql**: Added `shopping_lists`, `shopping_list_items`, and `b2b_discount_codes` tables
- **009_merchant_analytics.sql**: Added `gtmId`, `ga4Id`, and `allowsBackOrders` columns to merchants table

### Prisma Schema Updates
- Extended `Merchant` model with analytics and inventory settings
- Extended `Order` model with discount code and back-order tracking
- Extended `MerchantUser` with discount code creation relation
- Added `ShoppingList` and `ShoppingListItem` models (buyer-scoped, per-merchant)
- Added `B2bDiscountCode` model with validation and usage tracking
- Added `DiscountType` enum (`pct_off`, `fixed_amount`)

## Backend Services

### 1. Inventory Service (`apps/api/src/catalog/inventory.service.ts`)
- Batch inventory lookup with Redis caching (60s TTL)
- Returns inventory status: `in_stock` (≥20), `low_stock` (1-19), `out_of_stock` (0)
- Merchant back-order setting integration
- Cache invalidation support
- **Note**: Placeholder implementation - awaits `ShopifyApiService.getVariant()` method

### 2. Shopping Lists Service (`apps/api/src/shopping-lists/shopping-lists.service.ts`)
- CRUD operations for buyer shopping lists (max 200 items per list)
- Save entire cart to list (replaces existing items atomically)
- List/item management with conflict detection
- Buyer and merchant scoping

### 3. Discount Codes Service (`apps/api/src/discount-codes/discount-codes.service.ts`)
- Server-side discount validation (timing, usage limits, min order amount)
- Supports percentage-off and fixed-amount discounts
- Case-insensitive code matching
- Usage tracking and statistics
- Merchant-scoped code management

### 4. GA4 Analytics Service (`apps/api/src/analytics/ga4.service.ts`)
- Event tracking to Google Analytics 4 Measurement Protocol
- Merchant-specific configuration (GTM ID + GA4 measurement ID)
- Redis-cached config (1 hour TTL)
- Events: `purchase`, `view_item`, `add_to_cart`, `begin_checkout`

### 5. Orders Service Integration
- Extended `createBulkOrder` to validate and apply discount codes
- Inventory check with back-order validation
- Discount amount calculated server-side (banker's rounding)
- Credit reservation accounts for discounted total
- Persists discount code ID and amount to order record

## API Endpoints

### Buyer Portal
- `GET /buyer/catalog/inventory?variantIds=...` - Batch inventory lookup
- `POST /buyer/discount-codes/validate` - Validate discount code
- `GET /buyer/shopping-lists` - List all shopping lists
- `POST /buyer/shopping-lists` - Create new list
- `GET /buyer/shopping-lists/:id` - Get list items
- `POST /buyer/shopping-lists/:id/save-cart` - Save cart to list
- `PATCH /buyer/shopping-lists/:id` - Rename list
- `DELETE /buyer/shopping-lists/:id` - Delete list
- `GET /buyer/portal-config` - Get merchant GTM/GA4 config

### Merchant Admin
- `GET /discount-codes` - List all discount codes (cursor paginated)
- `POST /discount-codes` - Create discount code (owner/admin)
- `PATCH /discount-codes/:id/deactivate` - Deactivate code (owner/admin)
- `GET /discount-codes/:id/stats` - Get usage statistics
- `PATCH /merchants/settings` - Update analytics and inventory settings (owner/admin)

## Frontend Utilities

### Analytics Tracking (`apps/web/src/lib/analytics.ts`)
- Type-safe event tracking with TypeScript union types
- Supports both GTM dataLayer and direct GA4 gtag()
- Initialization helpers for GTM and GA4
- Events: `b2b_catalog_view`, `b2b_add_to_cart`, `b2b_order_placed`, `b2b_discount_applied`, `b2b_list_saved`, etc.

## Security & Validation

### Server-Side Validation
- Discount codes validated server-side only (never trust client)
- Minimum order amounts enforced after discount applied
- Credit limits checked against discounted total
- Back-order restrictions enforced per merchant settings

### Input Validation
- Zod schemas for all API inputs
- List names: 1-100 characters, unique per buyer+merchant
- Discount codes: case-insensitive, max 50 characters
- Shopping lists: max 200 items

## Caching Strategy

### Redis Caching
- **Inventory levels**: 60 seconds TTL
- **Merchant back-order setting**: 5 minutes TTL
- **GA4 config**: 1 hour TTL, negative results 5 minutes
- Cache invalidation on settings updates

## Module Dependencies

### New Modules
- `DiscountCodesModule` (exports `DiscountCodesService`)
- `ShoppingListsModule` (exports `ShoppingListsService`)
- `Ga4Service` exported from `AnalyticsModule`
- `InventoryService` exported from `CatalogModule`

### Module Relationships
- `OrdersModule` imports `DiscountCodesModule` and `CatalogModule`
- `MerchantsModule` imports `CatalogModule` for cache invalidation
- All modules registered in `AppModule`

## Testing Requirements

### Unit Tests Needed
- Discount validation logic (timing, usage, min order)
- Inventory status determination (in_stock/low_stock/out_of_stock)
- Shopping list conflict handling
- GA4 config parsing

### Integration Tests Needed
- Order creation with discount code
- Back-order prevention when disabled
- Shopping list save/load flow
- Discount code usage increment

## Implementation Notes

### Inventory Service Placeholder
The `InventoryService` currently returns placeholder data (quantity: 10) because `ShopifyApiService` doesn't yet have a `getVariant()` method. When that's implemented, update:
- `fetchAndCacheInventory()` method to call Shopify API
- Pass actual encrypted merchant token from guard

### Discount Code Integration
Discount codes are passed to `OrdersService.createBulkOrder()` via optional service parameters to avoid circular dependencies. The services are injected at the controller level.

### Future Enhancements
1. Add Shopify variant inventory API integration
2. Implement GTM server-side container support
3. Add discount code auto-expiry job
4. Shopping list sharing between buyers
5. Volume-based discount tiers

## Configuration

### Environment Variables (no new vars required)
All features use existing:
- `DATABASE_URL` / `DATABASE_DIRECT_URL`
- `REDIS_CACHE_URL`
- Merchant-specific GTM/GA4 IDs stored in database

### Merchant Settings
Merchants configure via admin UI:
- `gtmId`: Google Tag Manager container ID (e.g., "GTM-XXXXXXX")
- `ga4Id`: GA4 measurement ID + API secret (format: "G-XXXXXXXXXX|api_secret")
- `allowsBackOrders`: Boolean flag for inventory policy

## Deployment Checklist

- [x] Database migrations applied
- [x] Prisma client regenerated
- [x] API typecheck passing
- [ ] Run database migrations on staging/production
- [ ] Update merchant admin UI for settings
- [ ] Update buyer portal UI for shopping lists
- [ ] Update checkout flow for discount codes
- [ ] Add GTM/GA4 initialization to buyer portal layout
- [ ] Test discount code validation
- [ ] Test back-order prevention
- [ ] Verify analytics events firing

## API Documentation Updates Needed

Add to API docs:
- Inventory endpoint with variant ID format
- Discount code validation response structure
- Shopping list item schema
- Portal config response format
- Analytics tracking event types

---

**Status**: Backend implementation complete and type-safe. Frontend UI integration pending.
