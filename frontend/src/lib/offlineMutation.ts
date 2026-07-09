/**
 * offlineMutation.ts — local-only POS build
 *
 * Everything runs on a local PHP server (127.0.0.1:8080).
 * There is no remote server and no sync queue.
 * offlineMutate() simply calls the API; if the local server is temporarily
 * unavailable (still starting up) the mutation will throw and the caller's
 * onError handler will fire — no silent queuing.
 *
 * The { offline: false } shape is kept so existing call-sites compile without
 * changes; result.offline is always false.
 */
import type { QueryClient } from '@tanstack/react-query';

export async function offlineMutate<T>(
  apiFn: () => Promise<T>,
  _resource: string,
  _action: string,
  _payload: Record<string, unknown>,
  _resourceId?: number
): Promise<{ data: T; offline: false }> {
  const data = await apiFn();
  return { data, offline: false };
}

/**
 * Applies an optimistic in-memory update to the React Query cache.
 * Still used for instant UI feedback on create/update/delete operations.
 */
export function applyOptimisticUpdate(
  qc: QueryClient,
  resource: string,
  action: string,
  payload: Record<string, unknown>,
  resourceId?: number,
  tempId?: number
) {
  const localItem = { id: tempId ?? resourceId, ...payload, _offline: true };

  qc.setQueriesData(
    { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === resource },
    (old: any) => {
      if (old == null) return old;
      const isWrapped = old.data !== undefined && Array.isArray(old.data);
      const arr: any[] = isWrapped ? old.data : (Array.isArray(old) ? old : []);
      let updated: any[];
      if (action === 'create') {
        updated = [localItem, ...arr];
      } else if (action === 'update') {
        updated = arr.map((item: any) =>
          item.id === resourceId ? { ...item, ...payload } : item
        );
      } else if (action === 'delete') {
        updated = arr.filter((item: any) => item.id !== resourceId);
      } else {
        updated = arr.map((item: any) =>
          item.id === resourceId ? { ...item, ...payload } : item
        );
      }
      return isWrapped ? { ...old, data: updated } : updated;
    }
  );
}

/** Legacy no-op — kept so existing call-sites compile unchanged. */
export function handleOfflineSuccess(
  _qc: QueryClient,
  _result: { offline: boolean; tempId?: number },
  _resource: string,
  _action: string,
  _payload: Record<string, unknown>,
  _resourceId?: number
) {
  // No-op: local-only build, result.offline is always false.
}

