/**
 * useDBSync — local-only offline POS
 *
 * Silently refreshes the IndexedDB cache from the local PHP server on mount
 * so the POS can display products/customers even during the brief startup
 * window before the server is fully ready.
 *
 * No toasts, no sync buttons, no periodic polling.
 * The local PHP server IS the database — there is nothing to "sync to".
 */
import { useCallback, useEffect } from 'react';
import {
  productsApi, customersApi, usersApi,
} from '../api';
import { db } from '../lib/db';

export function useDBSync() {
  const refreshCache = useCallback(async () => {
    try {
      const [products, customers, usersResp] = await Promise.all([
        productsApi.list({ per_page: 500, is_active: 1 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
        customersApi.list({ per_page: 500 }).then(r => r.data?.data?.data ?? []),
        usersApi.list({ per_page: 500 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
      ]);

      await db.transaction('rw', db.products, db.customers, db.users, db.syncMeta, async () => {
        await db.products.clear();
        await db.products.bulkPut(products);
        await db.customers.clear();
        await db.customers.bulkPut(customers);
        await db.users.clear();
        await db.users.bulkPut(usersResp);
        await db.syncMeta.put({ key: 'last_sync', synced_at: Date.now() });
      });
    } catch {
      // Server not yet ready — IndexedDB retains previous data, POS continues working
    }
  }, []);

  useEffect(() => {
    // Clear stale pending mutations from old app versions on first mount
    db.pendingMutations.count().then(n => {
      if (n > 0) db.pendingMutations.clear().catch(() => {});
    }).catch(() => {});

    // Silently populate cache from local server
    void refreshCache();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose refreshCache as syncNow for any callers that still use it
  return { isSyncing: false, lastSynced: null as number | null, syncNow: refreshCache };
}
