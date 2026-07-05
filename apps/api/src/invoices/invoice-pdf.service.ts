import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createElement, type ReactElement } from 'react';
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';

export interface InvoicePdfLine {
  description: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  /** Per-line discount amount (decimal string). Renders as '—' when absent. */
  discount?: string | null;
}

/**
 * Input for {@link InvoicePdfService.generate}. The fields required by the
 * invoice-generate worker (`invoiceNumber`…`total`) are mandatory; the richer
 * fields (buyer contact + address, order reference, discount, payment
 * instructions, paid stamp) are optional so the worker path keeps compiling,
 * while InvoicesService can supply the full legal document.
 */
export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  merchantName: string;
  buyerCompany: string;
  currency: string;
  lines: InvoicePdfLine[];
  subtotal: string;
  taxAmount: string;
  total: string;
  paymentTerms?: string;
  buyerEmail?: string | null;
  /** Pre-formatted buyer address lines (street, city/region, postcode, country). */
  buyerAddressLines?: string[];
  /** Pre-formatted merchant address lines rendered under the merchant name. */
  merchantAddressLines?: string[];
  shippingAmount?: string;
  /** Shopify order name/number for the "Order Reference" line. */
  shopifyOrderNumber?: string | null;
  /** Applied discount code + amount (rendered in the summary, in green). */
  discountCode?: string | null;
  discountAmount?: string;
  /** When set, a faint diagonal PAID stamp is drawn across the page. */
  paidAt?: string | Date | null;
  /** Merchant remittance instructions; falls back to a sensible default. */
  paymentInstructions?: string | null;
}

/** Public alias matching the Prompt-3 task naming. */
export type InvoicePdfParams = InvoicePdfData;

export interface InvoicePdfResult {
  buffer: Buffer;
  sha256: string;
}

const PDF_TIMEOUT_MS = 15_000;

/** Custom error so the caller can alert (Sentry P1) on a render timeout. */
export class InvoiceRenderTimeoutError extends Error {
  constructor(public readonly invoiceNumber: string) {
    super(`Invoice PDF render timed out for ${invoiceNumber}`);
    this.name = 'InvoiceRenderTimeoutError';
  }
}

// IBM Plex Sans (Regular 400 + Bold 700) from the Google Fonts CDN, registered
// once at module load; @react-pdf fetches the TTFs lazily at first render. Only
// these two weights are registered — both are known-good static TTF URLs proven
// in production. We deliberately do NOT introduce a Medium (500) weight: a
// mis-typed gstatic hash would break every render (a critical financial path),
// so spec weights of 500/600 map onto 700 for emphasis instead.
Font.register({
  family: 'IBM Plex Sans',
  fonts: [
    {
      src: 'https://fonts.gstatic.com/s/ibmplexsans/v19/zYX9KVElMYYaJe8bpLHnCwDKjbLeEKxIedbzDw.ttf',
      fontWeight: 400,
    },
    {
      src: 'https://fonts.gstatic.com/s/ibmplexsans/v19/zYX9KVElMYYaJe8bpLHnCwDKjQ7sEKxIedbzDw.ttf',
      fontWeight: 700,
    },
  ],
});
// Disable hyphenation so SKUs and product codes never break mid-token.
Font.registerHyphenationCallback((word) => [word]);

// Palette — a clean accounting document. Structure comes from rule lines,
// whitespace, and a single blue accent on the document title. These literal
// hexes live only in the PDF (server-rendered), separate from the web design
// tokens.
const INK = '#18181B';
const MUTED = '#71717A';
const ACCENT = '#2563EB';
const SUCCESS = '#16A34A';
const RULE = '#E4E4E7';
const RULE_FAINT = '#F3F4F6';
const ZEBRA = '#FAFAFA';
const PANEL = '#F4F4F5';

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 10,
    fontFamily: 'IBM Plex Sans',
    color: INK,
    backgroundColor: '#FFFFFF',
  },

  // Header (2-column)
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { width: '60%', paddingRight: 12 },
  headerRight: { width: '40%', alignItems: 'flex-end' },
  merchantName: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  merchantAddress: { fontSize: 9, color: MUTED, lineHeight: 1.5 },
  docTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  invoiceNumber: { fontSize: 14, fontWeight: 700, color: INK },
  metaMuted: { fontSize: 9, color: MUTED, marginTop: 4 },
  metaStrong: { fontSize: 9, color: INK, fontWeight: 700, marginTop: 2 },

  divider: { borderTopWidth: 0.5, borderTopColor: RULE, marginVertical: 16 },

  // Bill-to + order reference
  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  billBlock: { width: '60%', paddingRight: 12 },
  refBlock: { width: '40%', alignItems: 'flex-end' },
  labelSm: {
    fontSize: 8,
    fontWeight: 700,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  buyerCompany: { fontSize: 11, fontWeight: 700, marginBottom: 3 },
  buyerAddress: { fontSize: 9, color: MUTED, lineHeight: 1.5 },
  buyerEmail: { fontSize: 9, color: MUTED, marginTop: 2 },
  refLabel: { fontSize: 8, color: MUTED },
  refValue: { fontSize: 8, fontWeight: 700, marginTop: 1 },

  // Line-items table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: PANEL,
    paddingVertical: 7,
    paddingHorizontal: 5,
  },
  th: {
    fontSize: 8,
    fontWeight: 700,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  rowEven: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 7,
    paddingHorizontal: 5,
    borderBottomWidth: 0.3,
    borderBottomColor: RULE_FAINT,
  },
  rowOdd: {
    flexDirection: 'row',
    backgroundColor: ZEBRA,
    paddingVertical: 7,
    paddingHorizontal: 5,
    borderBottomWidth: 0.3,
    borderBottomColor: RULE_FAINT,
  },
  cell: { fontSize: 9, color: INK },
  cellNoBorder: { borderBottomWidth: 0 },
  colDesc: { width: '38%', paddingRight: 4 },
  colSku: { width: '12%', paddingRight: 4 },
  colQty: { width: '8%', textAlign: 'center', paddingRight: 4 },
  colUnit: { width: '14%', textAlign: 'right', paddingRight: 4 },
  colDisc: { width: '10%', textAlign: 'right', paddingRight: 4 },
  colTotal: { width: '18%', textAlign: 'right', fontWeight: 700 },

  // Summary
  summary: { marginTop: 14, alignSelf: 'flex-end', width: '45%' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, fontSize: 9 },
  summaryDiscount: { color: SUCCESS },
  summaryValue: { fontSize: 9 },
  summaryValueDiscount: { fontSize: 9, color: SUCCESS },
  summaryRule: { borderTopWidth: 0.5, borderTopColor: INK, marginVertical: 4 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: PANEL,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  totalLabel: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  totalValue: { fontSize: 12, fontWeight: 700 },

  // Payment instructions
  payBox: {
    marginTop: 24,
    backgroundColor: '#F9FAFB',
    borderRadius: 4,
    padding: 12,
    borderWidth: 0.5,
    borderColor: RULE,
  },
  payText: { fontSize: 9, color: INK, lineHeight: 1.6 },

  // PAID watermark
  paidWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paidText: {
    fontSize: 72,
    fontWeight: 700,
    color: SUCCESS,
    opacity: 0.08,
    transform: 'rotate(45deg)',
  },

  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 6,
    fontSize: 7,
    color: '#A1A1AA',
  },
});

/**
 * Renders invoice PDFs with @react-pdf/renderer (no headless browser). Output is
 * an accounting-standard document — QuickBooks/Xero grade, not a printed web
 * page. Generation is bounded by a 15s timeout, and a SHA-256 of the produced
 * bytes is returned for the `invoices.pdf_sha256` integrity column.
 */
@Injectable()
export class InvoicePdfService {
  async generate(data: InvoicePdfData): Promise<InvoicePdfResult> {
    const buffer = await this.withTimeout(
      renderToBuffer(this.buildDocument(data)),
      PDF_TIMEOUT_MS,
      data.invoiceNumber,
    );
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { buffer, sha256 };
  }

  private money(value: string, currency: string): string {
    return `${currency} ${value}`;
  }

  private isPositive(value: string | null | undefined): boolean {
    if (value === null || value === undefined || value === '') return false;
    const num = Number(value);
    return Number.isFinite(num) && num > 0;
  }

  private buildDocument(data: InvoicePdfData): ReactElement<DocumentProps> {
    // ── Header ────────────────────────────────────────────────────────────
    const merchantLines: ReactElement[] = [
      createElement(Text, { style: styles.merchantName, key: 'name' }, data.merchantName),
    ];
    (data.merchantAddressLines ?? []).forEach((line, i) => {
      if (line && line.trim().length > 0) {
        merchantLines.push(createElement(Text, { style: styles.merchantAddress, key: `m-${i}` }, line));
      }
    });
    const headerLeft = createElement(View, { style: styles.headerLeft }, ...merchantLines);

    const headerRightChildren: ReactElement[] = [
      createElement(Text, { style: styles.docTitle, key: 'title' }, 'Tax Invoice'),
      createElement(Text, { style: styles.invoiceNumber, key: 'num' }, data.invoiceNumber),
      createElement(Text, { style: styles.metaMuted, key: 'idate' }, `Invoice Date: ${data.invoiceDate}`),
      createElement(Text, { style: styles.metaStrong, key: 'due' }, `Due: ${data.dueDate}`),
    ];
    if (data.paymentTerms) {
      headerRightChildren.push(
        createElement(Text, { style: styles.metaMuted, key: 'terms' }, data.paymentTerms),
      );
    }
    const headerRight = createElement(View, { style: styles.headerRight }, ...headerRightChildren);
    const header = createElement(View, { style: styles.headerRow }, headerLeft, headerRight);

    // ── Bill-to + order reference ─────────────────────────────────────────
    const billChildren: ReactElement[] = [
      createElement(Text, { style: styles.labelSm, key: 'billto' }, 'Bill To'),
      createElement(Text, { style: styles.buyerCompany, key: 'company' }, data.buyerCompany),
    ];
    (data.buyerAddressLines ?? []).forEach((line, i) => {
      if (line && line.trim().length > 0) {
        billChildren.push(createElement(Text, { style: styles.buyerAddress, key: `b-${i}` }, line));
      }
    });
    if (data.buyerEmail) {
      billChildren.push(createElement(Text, { style: styles.buyerEmail, key: 'email' }, data.buyerEmail));
    }
    const billBlock = createElement(View, { style: styles.billBlock }, ...billChildren);

    const refChildren: ReactElement[] = [];
    if (data.shopifyOrderNumber) {
      refChildren.push(
        createElement(Text, { style: styles.refLabel, key: 'reflabel' }, 'Order Reference'),
        createElement(Text, { style: styles.refValue, key: 'refvalue' }, data.shopifyOrderNumber),
      );
    }
    const refBlock = createElement(View, { style: styles.refBlock }, ...refChildren);
    const billRow = createElement(View, { style: styles.billRow }, billBlock, refBlock);

    // ── Line items ────────────────────────────────────────────────────────
    const tableHeader = createElement(
      View,
      { style: styles.tableHeader },
      createElement(Text, { style: [styles.th, styles.colDesc] }, 'Description'),
      createElement(Text, { style: [styles.th, styles.colSku] }, 'SKU'),
      createElement(Text, { style: [styles.th, styles.colQty] }, 'Qty'),
      createElement(Text, { style: [styles.th, styles.colUnit] }, 'Unit Price'),
      createElement(Text, { style: [styles.th, styles.colDisc] }, 'Discount'),
      createElement(Text, { style: [styles.th, styles.colTotal] }, 'Line Total'),
    );

    const lastIndex = data.lines.length - 1;
    const rows = data.lines.map((line, index) => {
      const rowStyle = index % 2 === 0 ? styles.rowEven : styles.rowOdd;
      // Last row: drop the bottom rule for a clean table foot.
      const style = index === lastIndex ? [rowStyle, styles.cellNoBorder] : rowStyle;
      const discountText = this.isPositive(line.discount)
        ? `-${this.money(line.discount as string, data.currency)}`
        : '—';
      return createElement(
        View,
        { style, key: String(index) },
        createElement(Text, { style: [styles.cell, styles.colDesc] }, line.description),
        createElement(Text, { style: [styles.cell, styles.colSku] }, line.sku ?? '—'),
        createElement(Text, { style: [styles.cell, styles.colQty] }, String(line.quantity)),
        createElement(Text, { style: [styles.cell, styles.colUnit] }, this.money(line.unitPrice, data.currency)),
        createElement(Text, { style: [styles.cell, styles.colDisc] }, discountText),
        createElement(Text, { style: [styles.cell, styles.colTotal] }, this.money(line.lineTotal, data.currency)),
      );
    });

    // ── Summary ───────────────────────────────────────────────────────────
    const summaryChildren: ReactElement[] = [
      this.summaryPair('Subtotal', this.money(data.subtotal, data.currency), 'subtotal'),
    ];
    if (this.isPositive(data.taxAmount)) {
      summaryChildren.push(this.summaryPair('Tax', this.money(data.taxAmount, data.currency), 'tax'));
    }
    if (this.isPositive(data.shippingAmount)) {
      summaryChildren.push(
        this.summaryPair('Shipping', this.money(data.shippingAmount as string, data.currency), 'shipping'),
      );
    }
    if (data.discountCode && this.isPositive(data.discountAmount)) {
      summaryChildren.push(
        this.summaryPair(
          `Discount (${data.discountCode})`,
          `-${this.money(data.discountAmount as string, data.currency)}`,
          'discount',
          true,
        ),
      );
    }
    summaryChildren.push(createElement(View, { style: styles.summaryRule, key: 'rule' }));
    summaryChildren.push(
      createElement(
        View,
        { style: styles.totalRow, key: 'total' },
        createElement(Text, { style: styles.totalLabel }, 'Total Due'),
        createElement(Text, { style: styles.totalValue }, this.money(data.total, data.currency)),
      ),
    );
    const summary = createElement(View, { style: styles.summary }, ...summaryChildren);

    // ── Payment instructions ──────────────────────────────────────────────
    const instructions =
      data.paymentInstructions && data.paymentInstructions.trim().length > 0
        ? data.paymentInstructions.trim()
        : `Please remit ${this.money(data.total, data.currency)} by ${data.dueDate}, referencing invoice ` +
          `${data.invoiceNumber}. Contact ${data.merchantName} for remittance details or payment queries.`;
    const payBox = createElement(
      View,
      { style: styles.payBox },
      createElement(Text, { style: styles.labelSm }, 'Payment Instructions'),
      createElement(Text, { style: styles.payText }, instructions),
    );

    // ── Footer (repeats on every page) ────────────────────────────────────
    const footer = createElement(
      View,
      { style: styles.footer, fixed: true },
      createElement(Text, null, `Invoice ${data.invoiceNumber} — generated automatically.`),
      createElement(Text, {
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Page ${pageNumber} of ${totalPages}`,
      }),
    );

    // ── Optional PAID watermark (drawn first, behind flow content) ─────────
    const pageChildren: ReactElement[] = [];
    if (data.paidAt) {
      pageChildren.push(
        createElement(
          View,
          { style: styles.paidWrap, fixed: true, key: 'paid' },
          createElement(Text, { style: styles.paidText }, 'PAID'),
        ),
      );
    }
    pageChildren.push(
      header,
      createElement(View, { style: styles.divider, key: 'div1' }),
      billRow,
      createElement(View, { style: styles.divider, key: 'div2' }),
      tableHeader,
      ...rows,
      summary,
      payBox,
      footer,
    );

    const page = createElement(Page, { size: 'A4', style: styles.page }, ...pageChildren);
    return createElement(Document, { title: `Invoice ${data.invoiceNumber}` }, page);
  }

  private summaryPair(
    label: string,
    value: string,
    key: string,
    discount = false,
  ): ReactElement {
    const valueStyle = discount ? styles.summaryValueDiscount : styles.summaryValue;
    return createElement(
      View,
      { style: styles.summaryRow, key },
      createElement(Text, null, label),
      createElement(Text, { style: valueStyle }, value),
    );
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, invoiceNumber: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new InvoiceRenderTimeoutError(invoiceNumber)), ms);
      timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }
}
