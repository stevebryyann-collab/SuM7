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
}

/**
 * Input for {@link InvoicePdfService.generate}. The fields required by the
 * invoice-generate worker (`invoiceNumber`…`total`) are mandatory; the richer
 * fields (buyer contact + address, payment terms, shipping) are optional so the
 * worker path keeps compiling, while InvoicesService can supply the full legal
 * document.
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
  /** Pre-formatted address lines (street, city/region, postcode, country). */
  buyerAddressLines?: string[];
  shippingAmount?: string;
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

// IBM Plex Sans (Regular + Bold) from the Google Fonts CDN. Registered once at
// module load; @react-pdf fetches the TTFs lazily at first render.
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

// A clean accounting document — lines and columns, no decorative boxes, no color
// fills on content areas. Borders and whitespace provide structure.
const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: 'IBM Plex Sans',
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  merchantName: { fontSize: 14, fontWeight: 700 },
  docTitle: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 },
  metaGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  metaCol: { flexDirection: 'column', width: '48%' },
  metaPair: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
  metaLabel: { color: '#6B7280' },
  metaValue: { fontWeight: 700 },
  hr: { borderBottomWidth: 1, borderBottomColor: '#E5E7EB', marginVertical: 10 },
  sectionLabel: { color: '#6B7280', fontSize: 8, textTransform: 'uppercase', marginBottom: 3 },
  billTo: { marginBottom: 12 },
  billLine: {},
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#9CA3AF',
    paddingBottom: 3,
    marginBottom: 2,
  },
  headerCell: { fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: '#6B7280' },
  rowEven: { flexDirection: 'row', paddingVertical: 3, backgroundColor: '#FFFFFF', borderBottomWidth: 0.5, borderBottomColor: '#F3F4F6' },
  rowOdd: { flexDirection: 'row', paddingVertical: 3, backgroundColor: '#F9FAFB', borderBottomWidth: 0.5, borderBottomColor: '#F3F4F6' },
  colDesc: { width: '40%', paddingRight: 4 },
  colSku: { width: '15%', paddingRight: 4 },
  colQty: { width: '10%', textAlign: 'right', paddingRight: 4 },
  colUnit: { width: '17.5%', textAlign: 'right', paddingRight: 4 },
  colTotal: { width: '17.5%', textAlign: 'right' },
  summary: { marginTop: 12, alignSelf: 'flex-end', width: '45%' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  summaryGrand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 5,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: '#111827',
  },
  summaryGrandText: { fontSize: 12, fontWeight: 700 },
  payBox: {
    marginTop: 24,
    padding: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  payText: { fontSize: 8, color: '#374151' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#E5E7EB',
    paddingTop: 6,
    fontSize: 7,
    color: '#9CA3AF',
  },
});

/**
 * Renders invoice PDFs with @react-pdf/renderer (no headless browser). Output is
 * a clean accounting document. Generation is bounded by a 15s timeout, and a
 * SHA-256 of the produced bytes is returned for the `invoices.pdf_sha256`
 * integrity column.
 */
@Injectable()
export class InvoicePdfService {
  async generate(data: InvoicePdfData): Promise<InvoicePdfResult> {
    let buffer: Buffer;
    try {
      buffer = await this.withTimeout(
        renderToBuffer(this.buildDocument(data)),
        PDF_TIMEOUT_MS,
        data.invoiceNumber,
      );
    } catch (error) {
      if (error instanceof InvoiceRenderTimeoutError) {
        throw error;
      }
      throw error;
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { buffer, sha256 };
  }

  private money(value: string, currency: string): string {
    return `${currency} ${value}`;
  }

  private buildDocument(data: InvoicePdfData): ReactElement<DocumentProps> {
    const generatedAt = new Date().toISOString();

    const header = createElement(
      View,
      { style: styles.headerRow },
      createElement(Text, { style: styles.merchantName }, data.merchantName),
      createElement(Text, { style: styles.docTitle }, 'Tax Invoice'),
    );

    const metaLeft = createElement(
      View,
      { style: styles.metaCol },
      this.metaPair('Invoice Number', data.invoiceNumber),
      this.metaPair('Invoice Date', data.invoiceDate),
    );
    const metaRight = createElement(
      View,
      { style: styles.metaCol },
      this.metaPair('Due Date', data.dueDate),
      this.metaPair('Payment Terms', data.paymentTerms ?? '—'),
    );
    const meta = createElement(View, { style: styles.metaGrid }, metaLeft, metaRight);

    const billLines: ReactElement[] = [
      createElement(Text, { style: styles.billLine, key: 'company' }, data.buyerCompany),
    ];
    (data.buyerAddressLines ?? []).forEach((line, index) => {
      if (line && line.trim().length > 0) {
        billLines.push(createElement(Text, { style: styles.billLine, key: `addr-${index}` }, line));
      }
    });
    if (data.buyerEmail) {
      billLines.push(createElement(Text, { style: styles.billLine, key: 'email' }, data.buyerEmail));
    }
    const billTo = createElement(
      View,
      { style: styles.billTo },
      createElement(Text, { style: styles.sectionLabel }, 'Bill To'),
      ...billLines,
    );

    const tableHeader = createElement(
      View,
      { style: styles.tableHeader },
      createElement(Text, { style: [styles.headerCell, styles.colDesc] }, 'Description'),
      createElement(Text, { style: [styles.headerCell, styles.colSku] }, 'SKU'),
      createElement(Text, { style: [styles.headerCell, styles.colQty] }, 'Qty'),
      createElement(Text, { style: [styles.headerCell, styles.colUnit] }, 'Unit Price'),
      createElement(Text, { style: [styles.headerCell, styles.colTotal] }, 'Line Total'),
    );

    const rows = data.lines.map((line, index) =>
      createElement(
        View,
        { style: index % 2 === 0 ? styles.rowEven : styles.rowOdd, key: String(index) },
        createElement(Text, { style: styles.colDesc }, line.description),
        createElement(Text, { style: styles.colSku }, line.sku ?? '—'),
        createElement(Text, { style: styles.colQty }, String(line.quantity)),
        createElement(Text, { style: styles.colUnit }, this.money(line.unitPrice, data.currency)),
        createElement(Text, { style: styles.colTotal }, this.money(line.lineTotal, data.currency)),
      ),
    );

    const summaryRows: ReactElement[] = [
      this.summaryPair('Subtotal', this.money(data.subtotal, data.currency), 'subtotal'),
      this.summaryPair('Tax', this.money(data.taxAmount, data.currency), 'tax'),
    ];
    if (data.shippingAmount && Number(data.shippingAmount) !== 0) {
      summaryRows.push(
        this.summaryPair('Shipping', this.money(data.shippingAmount, data.currency), 'shipping'),
      );
    }
    const summary = createElement(
      View,
      { style: styles.summary },
      ...summaryRows,
      createElement(
        View,
        { style: styles.summaryGrand },
        createElement(Text, { style: styles.summaryGrandText }, 'Total'),
        createElement(Text, { style: styles.summaryGrandText }, this.money(data.total, data.currency)),
      ),
    );

    const payBox = createElement(
      View,
      { style: styles.payBox },
      createElement(Text, { style: styles.sectionLabel }, 'Payment Instructions'),
      createElement(
        Text,
        { style: styles.payText },
        `Please remit ${this.money(data.total, data.currency)} by ${data.dueDate}, referencing invoice ${data.invoiceNumber}. Contact ${data.merchantName} for remittance details or payment queries.`,
      ),
    );

    const footer = createElement(
      View,
      { style: styles.footer, fixed: true },
      createElement(Text, null, `${data.invoiceNumber} · generated ${generatedAt}`),
      createElement(Text, {
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Page ${pageNumber} of ${totalPages}`,
      }),
    );

    const page = createElement(
      Page,
      { size: 'A4', style: styles.page },
      header,
      meta,
      createElement(View, { style: styles.hr }),
      billTo,
      tableHeader,
      ...rows,
      summary,
      payBox,
      footer,
    );

    return createElement(Document, { title: `Invoice ${data.invoiceNumber}` }, page);
  }

  private metaPair(label: string, value: string): ReactElement {
    return createElement(
      View,
      { style: styles.metaPair, key: label },
      createElement(Text, { style: styles.metaLabel }, label),
      createElement(Text, { style: styles.metaValue }, value),
    );
  }

  private summaryPair(label: string, value: string, key: string): ReactElement {
    return createElement(
      View,
      { style: styles.summaryRow, key },
      createElement(Text, null, label),
      createElement(Text, null, value),
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
