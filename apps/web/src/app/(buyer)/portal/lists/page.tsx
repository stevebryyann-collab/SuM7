'use client';

import { useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { Bookmark, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { toast } from '@/components/shared/toasts';
import {
  useShoppingLists,
  useCreateShoppingList,
  useRenameShoppingList,
  useDeleteShoppingList,
  type ShoppingListSummary,
} from '@/hooks/useShoppingLists';
import { ApiClientError } from '@/lib/api/error';
import { formatRelative } from '@/lib/format';

/**
 * Buyer saved lists — reusable order templates. Create a list, then save your
 * catalog cart into it (from the catalog) and load it back into the cart in one
 * click whenever you reorder. Backend already exists (/buyer/shopping-lists).
 */
export default function SavedListsPage(): JSX.Element {
  const lists = useShoppingLists();
  const create = useCreateShoppingList();
  const rename = useRenameShoppingList();
  const remove = useDeleteShoppingList();

  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ShoppingListSummary | null>(null);

  const submitCreate = (): void => {
    const name = newName.trim();
    if (name.length === 0) return;
    create.mutate(name, {
      onSuccess: () => {
        setNewName('');
        toast.success(`List "${name}" created`);
      },
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Could not create list'),
    });
  };

  const startRename = (list: ShoppingListSummary): void => {
    setRenamingId(list.id);
    setRenameValue(list.name);
  };

  const submitRename = (list: ShoppingListSummary): void => {
    const name = renameValue.trim();
    if (name.length === 0 || name === list.name) {
      setRenamingId(null);
      return;
    }
    rename.mutate(
      { id: list.id, name },
      {
        onSuccess: () => {
          setRenamingId(null);
          toast.success('List renamed');
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not rename list'),
      },
    );
  };

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    remove.mutate(target.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success(`List "${target.name}" deleted`);
      },
      onError: (error) => {
        setDeleteTarget(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Could not delete list');
      },
    });
  };

  const rows = lists.data ?? [];

  return (
    <>
      <PageHeader
        title="Saved Lists"
        description="Reusable order templates. Save a cart, then load it back in one click when you reorder."
      />

      {/* Create */}
      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-4">
        <Input
          placeholder="New list name…"
          value={newName}
          maxLength={100}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') submitCreate();
          }}
          className="h-9 w-full sm:w-72"
          aria-label="New list name"
        />
        <Button
          variant="primary"
          onClick={submitCreate}
          disabled={create.isPending || newName.trim().length === 0}
        >
          {create.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          Create list
        </Button>
      </div>

      {lists.isLoading ? (
        <div className="panel p-4">
          <LoadingSkeleton rows={4} columns={[3, 1, 1]} />
        </div>
      ) : lists.isError ? (
        <div className="panel p-6 text-sm text-danger">Failed to load your lists. Please refresh.</div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Bookmark}
            title="No saved lists yet"
            description="Build a cart in the catalog and use “Save as list” to create a reusable order template."
            action={{ label: 'Go to catalog', href: '/portal/catalog' }}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((list) => {
            const isRenaming = renamingId === list.id;
            return (
              <div key={list.id} className="panel flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  {isRenaming ? (
                    <Input
                      autoFocus
                      value={renameValue}
                      maxLength={100}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') submitRename(list);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="h-8"
                      aria-label={`Rename ${list.name}`}
                    />
                  ) : (
                    <Link
                      href={`/portal/lists/${list.id}`}
                      className="font-medium text-text-primary transition-colors hover:text-accent"
                    >
                      {list.name}
                    </Link>
                  )}

                  {isRenaming ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => submitRename(list)}
                        className="text-success transition-colors hover:opacity-80"
                        aria-label="Save name"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="text-text-tertiary transition-colors hover:text-text-primary"
                        aria-label="Cancel rename"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startRename(list)}
                        className="text-text-tertiary transition-colors hover:text-text-primary"
                        aria-label={`Rename ${list.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(list)}
                        className="text-text-tertiary transition-colors hover:text-danger"
                        aria-label={`Delete ${list.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <p className="mt-1 text-sm text-text-secondary">
                  {list.itemCount} item{list.itemCount === 1 ? '' : 's'}
                </p>
                <p className="mt-auto pt-3 text-xs text-text-tertiary">
                  Updated {formatRelative(list.updatedAt)}
                </p>

                <Button variant="secondary" size="sm" className="mt-3" asChild>
                  <Link href={`/portal/lists/${list.id}`}>Open list</Link>
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this list?"
        description={
          deleteTarget ? (
            <span>
              “{deleteTarget.name}” will be permanently removed. Your order history is unaffected.
            </span>
          ) : null
        }
        confirmLabel="Delete"
        destructive
        isLoading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
