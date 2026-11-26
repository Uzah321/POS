/**
 * offlineMutation.ts — queue-and-replay offline mutations
 *
 * This is a fully local system (PHP + MariaDB on the same machine/LAN, no
 * cloud dependency) — but the local server can still be briefly unreachable
 * (starting up, restarting, a transient hiccup). A sale, cashup, stocktake,
 * etc. must never be lost just because that window was hit.
 *
 * offlineMutate() tries the real API call first. If it fails with a
 * *connectivity* error (no response received at all — the request never
 * reached the server, as opposed to the server responding with a 4xx/5xx,
 * which is a real error that should surface immediately), the mutation is
 * queued into IndexedDB (`pendingMutations`) and replayed later by
 * syncPendingMutations() (called from useDBSync on mount and on an interval).
 *
 * The URL/method to replay are read from the failed request's own axios
 * config — reliable for every call site since they all go through the same
 * `api` instance, so no call site needs to manually supply them (a couple of
 * older call sites still pass `_url`/`_method` in their payload; that's kept
 * as a fallback but is no longer required).
 */
import type { QueryClient } from '@tanstack/react-query';
import api from './axios';
import { db } from './db';

interface ReplayMeta { _url?: string; _method?: string }

function isConnectivityError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { request?: unknown; response?: unknown };
  // Axios sets `request` once the request is dispatched, and `response` only
  // if a response was actually received. No response + a request that was
  // sent means the server never answered — a connectivity problem, not a
  // real API error (which would have response.status set, e.g. 422/500).
  return e.request != null && e.response == null;
}

function stripReplayMeta<T extends Record<string, unknown>>(payload: T): Omit<T, '_url' | '_method'> {
  const { _url, _method, ...rest } = payload as T & ReplayMeta;
  return rest;
}

export async function offlineMutate<T>(
  apiFn: () => Promise<T>,
  resource: string,
  action: string,
  payload: Record<string, unknown>,
  resourceId?: number
): Promise<{ data: T | null; offline: boolean; tempId?: string }> {
  try {
    const data = await apiFn();
    return { data, offline: false };
  } catch (err: any) {
    if (!isConnectivityError(err)) throw err;

    const meta = payload as ReplayMeta;
    const url = err.config?.url ?? meta._url;
    const method = (err.config?.method ?? meta._method ?? 'post').toString().toUpperCase();

    if (!url) throw err; // nothing we can replay later — surface the original error

    const id = `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.pendingMutations.add({
      id,
      resource,
      action,
      resourceId,
      payload: { _url: url, _method: method, ...stripReplayMeta(payload) },
      queuedAt: Date.now(),
      attempts: 0,
    });
    return { data: null, offline: true, tempId: id };
  }
}

/**
 * Replays every queued mutation against the local server, oldest first.
 * Successful ones are removed; ones the server actively rejects (a real
 * 4xx/5xx — the data is now invalid, not just "server was unreachable") are
 * also dropped rather than retried forever. Only genuine connectivity
 * failures stay queued, with an incremented attempt count.
 */
export interface RejectedMutation {
  resource: string;
  action: string;
  error: string;
}

type SyncResult = { synced: number; failed: number; rejected: RejectedMutation[] };

let replaying = false;

export async function syncPendingMutations(): Promise<SyncResult> {
  // One pass at a time. A pass can outlast the 20s poll (on a bad line each
  // resend waits up to the 15s timeout), the poll restarts when the page
  // mounts, and every open tab polls the same queue — overlapping passes
  // sent one queued sale several times at once. Web Locks covers other tabs
  // where the page is secure (https, localhost); `replaying` covers this tab.
  if (replaying) return { synced: 0, failed: 0, rejected: [] };
  replaying = true;
  try {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks?.request) {
      return await locks.request('core-pending-mutations', { ifAvailable: true }, (lock) =>
        lock ? replayQueue() : { synced: 0, failed: 0, rejected: [] });
    }
    return await replayQueue();
  } finally {
    replaying = false;
  }
}

async function replayQueue(): Promise<SyncResult> {
  // `queuedAt` isn't part of the Dexie index (only `id`/`resource` are), so
  // .orderBy('queuedAt') throws a SchemaError — sort in memory instead.
  const queued = (await db.pendingMutations.toArray()).sort((a, b) => a.queuedAt - b.queuedAt);
  let synced = 0;
  let failed = 0;
  const rejected: RejectedMutation[] = [];

  for (const m of queued) {
    const { _url, _method, ...body } = (m.payload ?? {}) as Record<string, unknown> & ReplayMeta;
    // A Settings save queued by an older version holds the whole page as it
    // was then: sent now, it would put back everything changed since (Enable
    // Tax turned itself off). Settings are only saved online now.
    if (!_url || m.resource === 'settings') {
      await db.pendingMutations.delete(m.id);
      continue;
    }
    try {
      await api.request({ url: _url, method: (_method ?? 'POST') as any, data: body });
      await db.pendingMutations.delete(m.id);
      synced++;
    } catch (err: any) {
      if (!isConnectivityError(err)) {
        // A real 4xx/5xx — the server actively rejected this data, retrying
        // won't help. Drop it from the queue but tell the caller so the user
        // isn't left thinking it silently synced when it actually vanished.
        await db.pendingMutations.delete(m.id);
        const serverMessage = err?.response?.data?.message;
        rejected.push({
          resource: m.resource,
          action: m.action,
          error: typeof serverMessage === 'string' ? serverMessage : (err instanceof Error ? err.message : String(err)),
        });
      } else {
        await db.pendingMutations.update(m.id, {
          attempts: (m.attempts ?? 0) + 1,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
      failed++;
    }
  }
  return { synced, failed, rejected };
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
  _result: { offline: boolean; tempId?: string | number },
  _resource: string,
  _action: string,
  _payload: Record<string, unknown>,
  _resourceId?: number
) {
  // No-op — queuing/replay is handled by offlineMutate/syncPendingMutations.
}
