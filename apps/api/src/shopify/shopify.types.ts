/**
 * Typed views over the Shopify Admin REST API (2025-10) resources this platform
 * consumes. These are intentionally partial — only fields the platform reads or
 * writes are modelled — but every modelled field is strongly typed (zero `any`).
 * Monetary values are kept as the strings Shopify returns to avoid float drift.
 */

export interface ShopifyAddress {
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  province_code: string | null;
  country: string | null;
  country_code: string | null;
  zip: string | null;
  phone: string | null;
}

export interface ShopifyCustomer {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  /** Present on B2B customers belonging to a company. */
  default_address: ShopifyAddress | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface ShopifyLineItem {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  /** Per-unit price as a decimal string, e.g. "19.99". */
  price: string;
  total_discount: string;
  grams: number;
  taxable: boolean;
  fulfillment_status: string | null;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  order_number: number;
  email: string | null;
  currency: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  subtotal_price: string;
  total_tax: string;
  total_shipping_price_set: {
    shop_money: { amount: string; currency_code: string };
  } | null;
  total_price: string;
  line_items: ShopifyLineItem[];
  customer: ShopifyCustomer | null;
  billing_address: ShopifyAddress | null;
  shipping_address: ShopifyAddress | null;
  note: string | null;
  tags: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string | null;
  /** Per-unit price as a decimal string. */
  price: string;
  compare_at_price: string | null;
  position: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  inventory_quantity: number;
  inventory_management: string | null;
  available?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopifyProductOption {
  id: number;
  name: string;
  position: number;
  values: string[];
}

export interface ShopifyProductImage {
  id: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
  variant_ids: number[];
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  status: "active" | "archived" | "draft";
  tags: string;
  options: ShopifyProductOption[];
  variants: ShopifyVariant[];
  images: ShopifyProductImage[];
  image: ShopifyProductImage | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface ShopifyDraftOrderLineItemInput {
  variant_id?: number;
  title?: string;
  quantity: number;
  /** Override price (decimal string). Required when no variant_id is given. */
  price?: string;
  sku?: string;
}

export interface ShopifyDraftOrderInput {
  line_items: ShopifyDraftOrderLineItemInput[];
  customer?: { id: number };
  email?: string;
  currency?: string;
  note?: string;
  tags?: string;
  use_customer_default_address?: boolean;
}

export interface ShopifyDraftOrder {
  id: number;
  name: string;
  status: "open" | "invoice_sent" | "completed";
  currency: string;
  subtotal_price: string;
  total_tax: string;
  total_price: string;
  invoice_url: string | null;
  order_id: number | null;
  line_items: ShopifyLineItem[];
  customer: ShopifyCustomer | null;
  email: string | null;
  note: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ListProductsParams {
  /** Page size (Shopify max 250). */
  limit?: number;
  status?: "active" | "archived" | "draft";
  /** ISO-8601; only products updated at or after this time. */
  updatedAtMin?: string;
  /** Restrict to a comma-separated set of product ids. */
  ids?: string;
}
