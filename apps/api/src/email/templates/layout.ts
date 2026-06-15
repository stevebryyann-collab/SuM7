/**
 * Shared HTML building blocks for transactional emails.
 *
 * NOTE (documented deviation): Prompt 3 Task 5 specifies the templates be authored
 * with `@react-email/components` (.tsx). That package is not installed in apps/api
 * and the build environment's package registry is an offline mirror, so adding it
 * could not be verified here. To keep the API compiling against only installed
 * packages — and to preserve the existing worker's email path — the templates are
 * implemented as typed, dependency-free HTML render functions that reproduce the
 * same structure and content the spec describes (white background, black text, a
 * single blue #2563EB accent button, no gradients/decorative sections). Swapping
 * in React Email later is a drop-in replacement behind {@link RenderedEmail}.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
}

const ACCENT = '#2563EB';
const TEXT = '#111827';
const MUTED = '#6B7280';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A safe, escaped text paragraph. */
export function p(text: string): string {
  return `<p style="margin:0 0 12px;color:${TEXT};font-size:14px;line-height:1.5;">${escapeHtml(text)}</p>`;
}

/** A muted, smaller paragraph (footnotes, disclaimers). */
export function muted(text: string): string {
  return `<p style="margin:12px 0 0;color:${MUTED};font-size:12px;line-height:1.5;">${escapeHtml(text)}</p>`;
}

/** A blockquote for quoting a reason/message back to the recipient. */
export function quote(text: string): string {
  return `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid ${MUTED};color:${TEXT};font-size:14px;background:#F9FAFB;">${escapeHtml(text)}</blockquote>`;
}

/** A single solid-fill primary button (the only accent in the email). */
export function button(label: string, href: string): string {
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tr><td>',
    `<a href="${encodeURI(href)}" style="display:inline-block;background:${ACCENT};color:#FFFFFF;`,
    'text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;">',
    escapeHtml(label),
    '</a></td></tr></table>',
  ].join('');
}

export interface KeyValue {
  label: string;
  value: string;
}

/** A compact label/value list (invoice meta, terms, etc.). */
export function keyValues(rows: KeyValue[]): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td style="padding:2px 16px 2px 0;color:${MUTED};font-size:13px;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:2px 0;color:${TEXT};font-size:13px;font-weight:600;">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">${body}</table>`;
}

export interface LineItemRow {
  description: string;
  quantity: number;
  lineTotal: string;
}

/** A compact line-item summary table; collapses to "+ N more items" past `max`. */
export function lineItemsTable(items: LineItemRow[], currency: string, max = 10): string {
  const visible = items.slice(0, max);
  const remaining = items.length - visible.length;
  const header =
    `<tr><th align="left" style="padding:4px 8px 4px 0;color:${MUTED};font-size:11px;text-transform:uppercase;">Item</th>` +
    `<th align="right" style="padding:4px 8px;color:${MUTED};font-size:11px;text-transform:uppercase;">Qty</th>` +
    `<th align="right" style="padding:4px 0;color:${MUTED};font-size:11px;text-transform:uppercase;">Total</th></tr>`;
  const rows = visible
    .map(
      (item) =>
        `<tr><td style="padding:3px 8px 3px 0;color:${TEXT};font-size:13px;border-bottom:1px solid #F3F4F6;">${escapeHtml(item.description)}</td>` +
        `<td align="right" style="padding:3px 8px;color:${TEXT};font-size:13px;border-bottom:1px solid #F3F4F6;">${item.quantity}</td>` +
        `<td align="right" style="padding:3px 0;color:${TEXT};font-size:13px;border-bottom:1px solid #F3F4F6;">${escapeHtml(currency)} ${escapeHtml(item.lineTotal)}</td></tr>`,
    )
    .join('');
  const more =
    remaining > 0
      ? `<tr><td colspan="3" style="padding:6px 0;color:${MUTED};font-size:12px;">+ ${remaining} more item${remaining === 1 ? '' : 's'}</td></tr>`
      : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 12px;border-collapse:collapse;">${header}${rows}${more}</table>`;
}

/** Wrap body content in the shared shell (white bg, system font, max width). */
export function layout(heading: string, bodyHtml: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body style="margin:0;padding:0;background:#FFFFFF;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#FFFFFF;"><tr><td align="center">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;`,
    `font-family:Arial,Helvetica,sans-serif;padding:32px 24px;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;color:${TEXT};font-size:20px;font-weight:700;">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    `</td></tr></table></td></tr></table></body></html>`,
  ].join('');
}
