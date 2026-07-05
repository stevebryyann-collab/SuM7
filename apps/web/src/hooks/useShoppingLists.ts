'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { buyerFetch } from '@/lib/api/buyer';

/** A saved list summary (`GET /buyer/shopping-lists`). Dates arrive as ISO strings. */
export interface ShoppingListSummary {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One saved-list line (`GET /buyer/shopping-lists/:id`). */
export interface ShoppingListItem {
  id: string;
  listId: string;
  shopifyVariantId: string;
  shopifyProductId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  createdAt: string;
}

/** Cart line shape accepted by the save-cart endpoint. */
export interface SaveCartItemInput {
  shopifyVariantId: string;
  shopifyProductId: string;
  productTitle: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
}

export const shoppingListKeys = {
  all: ['shopping-lists'] as const,
  items: (id: string) => [...shoppingListKeys.all, 'items', id] as const,
};

/** The buyer's saved lists, newest-updated first. */
export function useShoppingLists(): UseQueryResult<ShoppingListSummary[]> {
  return useQuery({
    queryKey: shoppingListKeys.all,
    queryFn: ({ signal }) => buyerFetch<ShoppingListSummary[]>('/buyer/shopping-lists', { signal }),
  });
}

/** Items in one saved list. Disabled until a listId is supplied. */
export function useShoppingListItems(listId: string | null): UseQueryResult<ShoppingListItem[]> {
  return useQuery({
    queryKey: shoppingListKeys.items(listId ?? ''),
    enabled: listId !== null,
    queryFn: ({ signal }) =>
      buyerFetch<ShoppingListItem[]>(`/buyer/shopping-lists/${listId}`, { signal }),
  });
}

/** Create an empty saved list. */
export function useCreateShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      buyerFetch<{ id: string; name: string }>('/buyer/shopping-lists', {
        method: 'POST',
        body: { name },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shoppingListKeys.all }),
  });
}

/** Rename a saved list (409 if the new name collides). */
export function useRenameShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      buyerFetch<void>(`/buyer/shopping-lists/${id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shoppingListKeys.all }),
  });
}

/** Delete a saved list. */
export function useDeleteShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      buyerFetch<void>(`/buyer/shopping-lists/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shoppingListKeys.all }),
  });
}

/** Replace a list's contents with the given cart lines (server clears + re-inserts). */
export function useSaveCartToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, items }: { listId: string; items: SaveCartItemInput[] }) =>
      buyerFetch<void>(`/buyer/shopping-lists/${listId}/save-cart`, {
        method: 'POST',
        body: { items },
      }),
    onSuccess: (_data, { listId }) => {
      void qc.invalidateQueries({ queryKey: shoppingListKeys.all });
      void qc.invalidateQueries({ queryKey: shoppingListKeys.items(listId) });
    },
  });
}
