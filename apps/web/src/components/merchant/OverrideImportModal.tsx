'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import {
  PricingOverrideSchema,
  type BulkPricingOverrideInput,
  type PricingOverrideInput,
} from '@b2b/shared/schemas';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ApiClientError } from '@/lib/api/error';
import { useBulkOverrides } from '@/hooks/usePricingTiers';

const HEADERS = ['shopifyProductId', 'shopifyVariantId', 'price', 'compareAtPrice', 'currency'] as const;
const MAX_ROWS = 500;

interface ParsedRow {
  line: number;
  raw: Record<string, string>;
  override: PricingOverrideInput | null;
  error: string | null;
}

export interface OverrideImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tierId: string;
}

/**
 * CSV import for per-variant price overrides. The merchant pastes (or uploads) a
 * CSV; every row is parsed and validated against the SAME PricingOverrideSchema
 * the API enforces, then shown in a preview table with a per-row match status.
 * Only valid rows are submitted via the bulk-upsert endpoint (capped at 500 to
 * match the server limit). Nothing is written until the merchant confirms.
 */
export function OverrideImportModal({
  open,
  onOpenChange,
  tierId,
}: OverrideImportModalProps): JSX.Element {
  const bulk = useBulkOverrides();
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo<ParsedRow[]>(() => parseCsv(text), [text]);
  const validRows = useMemo(() => rows.filter((r) => r.override !== null), [rows]);
  const invalidCount = rows.length - validRows.length;
  const overLimit = validRows.length > MAX_ROWS;

  const reset = (): void => {
    setText('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const onFile = (file: File | undefined): void => {
    if (!file) return;
    void file.text().then(setText);
  };

  const onConfirm = (): void => {
    const overrides = validRows.map((r) => r.override).filter(Boolean) as PricingOverrideInput[];
    if (overrides.length === 0) {
      toast.error('No valid rows to import');
      return;
    }
    const input: BulkPricingOverrideInput = { overrides };
    bulk.mutate(
      { id: tierId, input },
      {
        onSuccess: (result) => {
          toast.success(`${result.upserted} override${result.upserted === 1 ? '' : 's'} imported`);
          reset();
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Import failed'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !bulk.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import price overrides</DialogTitle>
          <DialogDescription>
            CSV columns: {HEADERS.join(', ')}. A header row is optional. Variant, compare-at and
            currency are optional (currency defaults to USD).
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="csvText">Paste CSV</Label>
              <Button
                variant="default"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={bulk.isPending}
              >
                <Upload className="h-4 w-4" />
                Upload file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
            <Textarea
              id="csvText"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'gid://shopify/Product/8801,gid://shopify/ProductVariant/41001,38.00,52.00,USD'}
              className="font-mono text-xs"
            />
          </div>

          {rows.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>
                  {validRows.length} valid · {invalidCount} invalid · {rows.length} total
                </span>
                {overLimit ? (
                  <span className="text-red-700">Over {MAX_ROWS}-row limit — trim before importing.</span>
                ) : null}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Product / Variant</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Compare</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.line}>
                        <TableCell className="text-gray-400 tabular-nums">{row.line}</TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs">
                          {row.raw.shopifyProductId || '—'}
                          {row.raw.shopifyVariantId ? (
                            <span className="block text-gray-400">{row.raw.shopifyVariantId}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {row.raw.price || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-gray-500">
                          {row.raw.compareAtPrice || '—'}
                        </TableCell>
                        <TableCell>
                          {row.override ? (
                            <StatusBadge status="approved" label="Valid" />
                          ) : (
                            <span title={row.error ?? ''}>
                              <StatusBadge status="rejected" label="Invalid" />
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="default" disabled={bulk.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={bulk.isPending || validRows.length === 0 || overLimit}
            onClick={onConfirm}
          >
            {bulk.isPending ? <Spinner /> : null}
            Import {validRows.length > 0 ? `${validRows.length} row${validRows.length === 1 ? '' : 's'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Parse CSV text into validated rows. Tolerates an optional header line (skipped
 * when the first cell isn't a plausible product id). Each data row is validated
 * with PricingOverrideSchema so the preview's status matches the server exactly.
 */
function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Drop a header row if present (first cell equals a known header name).
  const firstCells = (lines[0] ?? '').split(',').map((c) => c.trim());
  const hasHeader = firstCells[0] === 'shopifyProductId';
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const headerOffset = hasHeader ? 2 : 1;

  return dataLines.map((line, index) => {
    const cells = line.split(',').map((c) => c.trim());
    const raw: Record<string, string> = {};
    HEADERS.forEach((header, i) => {
      raw[header] = cells[i] ?? '';
    });

    const candidate: Record<string, unknown> = {
      shopifyProductId: raw.shopifyProductId,
      price: raw.price,
    };
    if (raw.shopifyVariantId) candidate.shopifyVariantId = raw.shopifyVariantId;
    if (raw.compareAtPrice) candidate.compareAtPrice = raw.compareAtPrice;
    if (raw.currency) candidate.currency = raw.currency;

    const parsed = PricingOverrideSchema.safeParse(candidate);
    return {
      line: index + headerOffset,
      raw,
      override: parsed.success ? parsed.data : null,
      error: parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Invalid row'),
    };
  });
}
