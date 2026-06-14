import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createElement, type ReactElement } from 'react';
import {
  Document,
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
}

export interface InvoicePdfResult {
  buffer: Buffer;
  sha256: string;
}

const PDF_TIMEOUT_MS = 15_000;

// A clean accounting document — lines and columns, no decorative boxes or color
// fills. Borders and whitespace provide structure (per the project design rules).
const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 48, paddingHorizontal: 48, fontSize: 10, color: '#111827' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 20, fontWeight: 'bold' },
  merchant: { fontSize: 12, fontWeight: 'bold' },
  metaLabel: { color: '#6b7280' },
  metaValue: { fontWeight: 'bold' },
  metaBlock: { textAlign: 'right' },
  section: { marginBottom: 16 },
  sectionLabel: { color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', fontSize: 8 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    paddingBottom: 4,
    marginBottom: 4,
    fontWeight: 'bold',
  },
  row: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  colDesc: { flex: 4 },
  colQty: { flex: 1, textAlign: 'right' },
  colUnit: { flex: 2, textAlign: 'right' },
  colTotal: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 12, alignSelf: 'flex-end', width: '40%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalsGrand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#111827',
    fontWeight: 'bold',
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
    const buffer = await this.withTimeout(renderToBuffer(this.buildDocument(data)), PDF_TIMEOUT_MS);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { buffer, sha256 };
  }

  private money(value: string, currency: string): string {
    return `${currency} ${value}`;
  }

  private buildDocument(data: InvoicePdfData): ReactElement<DocumentProps> {
    const lineRows = data.lines.map((line, index) =>
      createElement(
        View,
        { style: styles.row, key: String(index) },
        createElement(
          Text,
          { style: styles.colDesc },
          line.sku ? `${line.description} (${line.sku})` : line.description,
        ),
        createElement(Text, { style: styles.colQty }, String(line.quantity)),
        createElement(Text, { style: styles.colUnit }, this.money(line.unitPrice, data.currency)),
        createElement(Text, { style: styles.colTotal }, this.money(line.lineTotal, data.currency)),
      ),
    );

    const header = createElement(
      View,
      { style: styles.headerRow },
      createElement(
        View,
        null,
        createElement(Text, { style: styles.title }, 'INVOICE'),
        createElement(Text, { style: styles.merchant }, data.merchantName),
      ),
      createElement(
        View,
        { style: styles.metaBlock },
        createElement(Text, null, createElement(Text, { style: styles.metaLabel }, 'No.  ')),
        createElement(Text, { style: styles.metaValue }, data.invoiceNumber),
        createElement(Text, { style: styles.metaLabel }, `Issued ${data.invoiceDate}`),
        createElement(Text, { style: styles.metaLabel }, `Due ${data.dueDate}`),
      ),
    );

    const billTo = createElement(
      View,
      { style: styles.section },
      createElement(Text, { style: styles.sectionLabel }, 'Bill to'),
      createElement(Text, null, data.buyerCompany),
    );

    const tableHeader = createElement(
      View,
      { style: styles.tableHeader },
      createElement(Text, { style: styles.colDesc }, 'Description'),
      createElement(Text, { style: styles.colQty }, 'Qty'),
      createElement(Text, { style: styles.colUnit }, 'Unit'),
      createElement(Text, { style: styles.colTotal }, 'Amount'),
    );

    const totals = createElement(
      View,
      { style: styles.totals },
      createElement(
        View,
        { style: styles.totalsRow },
        createElement(Text, null, 'Subtotal'),
        createElement(Text, null, this.money(data.subtotal, data.currency)),
      ),
      createElement(
        View,
        { style: styles.totalsRow },
        createElement(Text, null, 'Tax'),
        createElement(Text, null, this.money(data.taxAmount, data.currency)),
      ),
      createElement(
        View,
        { style: styles.totalsGrand },
        createElement(Text, null, 'Total'),
        createElement(Text, null, this.money(data.total, data.currency)),
      ),
    );

    const page = createElement(
      Page,
      { size: 'A4', style: styles.page },
      header,
      billTo,
      tableHeader,
      ...lineRows,
      totals,
    );

    return createElement(Document, { title: `Invoice ${data.invoiceNumber}` }, page);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('PDF generation timed out')), ms);
      timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }
}
