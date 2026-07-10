'use client';

import { useState } from 'react';
import { Bookmark, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/shared/toasts';
import {
  useShoppingLists,
  useCreateShoppingList,
  useSaveCartToList,
  type SaveCartItemInput,
} from '@/hooks/useShoppingLists';
import { ApiClientError } from '@/lib/api/error';

interface SaveToListModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current cart, already flattened to save-cart line shape. */
  items: SaveCartItemInput[];
}

/**
 * "Save cart as list" — the only path that populates a saved list (the API has
 * no per-item add; save-cart replaces a list's contents wholesale). Offers
 * create-new or overwrite-existing. Reached from the catalog's cart actions.
 */
export function SaveToListModal({ open, onOpenChange, items }: SaveToListModalProps): JSX.Element {
  const lists = useShoppingLists();
  const create = useCreateShoppingList();
  const save = useSaveCartToList();
  const [name, setName] = useState('');

  const busy = create.isPending || save.isPending;
  const empty = items.length === 0;

  const saveToExisting = (listId: string, listName: string): void => {
    save.mutate(
      { listId, items },
      {
        onSuccess: () => {
          toast.success(`Saved ${items.length} product${items.length === 1 ? '' : 's'} to “${listName}”`);
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not save to list'),
      },
    );
  };

  const createAndSave = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || empty) return;
    create.mutate(trimmed, {
      onSuccess: (created) =>
        save.mutate(
          { listId: created.id, items },
          {
            onSuccess: () => {
              toast.success(`Saved to new list “${created.name}”`);
              setName('');
              onOpenChange(false);
            },
            onError: (error) =>
              toast.error(error instanceof ApiClientError ? error.message : 'Could not save to list'),
          },
        ),
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Could not create list'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save cart as list</DialogTitle>
          <DialogDescription>
            {empty
              ? 'Add items to your cart first, then save them as a reusable list.'
              : `${items.length} product${items.length === 1 ? '' : 's'} in your cart. Saving into an existing list replaces its contents.`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {/* Create new */}
          <div className="space-y-1.5">
            <Label htmlFor="newListName">Save to a new list</Label>
            <div className="flex gap-2">
              <Input
                id="newListName"
                value={name}
                maxLength={100}
                placeholder="e.g. Weekly basics"
                disabled={busy || empty}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createAndSave();
                }}
              />
              <Button
                variant="primary"
                onClick={createAndSave}
                disabled={busy || empty || name.trim().length === 0}
                className="shrink-0"
              >
                {create.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                Create &amp; save
              </Button>
            </div>
          </div>

          {/* Overwrite existing */}
          {lists.data && lists.data.length > 0 ? (
            <div className="space-y-1.5">
              <Label>Or overwrite an existing list</Label>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {lists.data.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    disabled={busy || empty}
                    onClick={() => saveToExisting(list.id, list.name)}
                    className="flex w-full items-center justify-between rounded-2xl border border-glass-border bg-white/50 px-4 py-2.5 text-left transition-all duration-fast hover:bg-white/70 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <Bookmark className="h-4 w-4 text-text-tertiary" />
                      {list.name}
                    </span>
                    <span className="text-xs text-text-tertiary">
                      {list.itemCount} item{list.itemCount === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
