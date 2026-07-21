/**
 * useDBSync — local-first offline POS
 *
 * Two jobs:
 *  1. Refresh the IndexedDB cache (products/customers/users) from the local
 *     PHP server on mount, so the POS can display data even during the brief
 *     startup window before the server is fully ready.
 *  2. Replay any mutations that were queued while the local server was
 *     briefly unreachable (see lib/offlineMutation.ts) — on mount, and on a
 *     short interval, so a sale/cashup/stocktake made during a hiccup is
 *     never silently lost.
 */
import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  productsApi, customersApi, usersApi, suppliersApi, branchesApi,
} from '../api';
import { db } from '../lib/db';
import { syncPendingMutations } from '../lib/offlineMutation';

const SYNC_INTERVAL_MS = 20000;

export function useDBSync() {
  const qc = useQueryClient();

  const refreshCache = useCallback(async () => {
    try {
      const [products, customers, usersResp, suppliers, branches] = await Promise.all([
        productsApi.list({ per_page: 500, is_active: 1 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
        customersApi.list({ per_page: 500 }).then(r => r.data?.data?.data ?? []),
        usersApi.list({ per_page: 500 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
        suppliersApi.list({ per_page: 500 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
        branchesApi.list().then(r => r.data?.data?.data ?? r.data?.data ?? []),
      ]);

      await db.transaction('rw', [db.products, db.customers, db.users, db.suppliers, db.branches, db.syncMeta], async () => {
        await db.products.clear();
        await db.products.bulkPut(products);
        await db.customers.clear();
        await db.customers.bulkPut(customers);
        await db.users.clear();
        await db.users.bulkPut(usersResp);
        await db.suppliers.clear();
        await db.suppliers.bulkPut(suppliers);
        await db.branches.clear();
        await db.branches.bulkPut(branches);
        await db.syncMeta.put({ key: 'last_sync', synced_at: Date.now() });
      });
    } catch {
      // Server not yet ready — IndexedDB retains previous data, POS continues working
    }
  }, []);

  const syncPending = useCallback(async () => {
    try {
      const { synced, rejected } = await syncPendingMutations();
      for (const r of rejected) {
        // The server actively rejected this once it came back online (e.g. a
        // validation error) — surface it instead of letting it vanish silently.
        toast.error(`Could not sync an offline ${r.resource} ${r.action}: ${r.error}`, { duration: 8000 });
      }
      if (synced > 0) {
        // Something queued offline just made it to the server — refresh the
        // views most likely to show it without waiting for a manual reload.
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        qc.invalidateQueries({ queryKey: ['sales'] });
        qc.invalidateQueries({ queryKey: ['my-sales'] });
        qc.invalidateQueries({ queryKey: ['inventory'] });
        qc.invalidateQueries({ queryKey: ['inventory-low-count'] });
        qc.invalidateQueries({ queryKey: ['inventory-out-count'] });
        qc.invalidateQueries({ queryKey: ['pos-products'] });
        qc.invalidateQueries({ queryKey: ['stocktakes'] });
        qc.invalidateQueries({ queryKey: ['shift-history'] });
        qc.invalidateQueries({ queryKey: ['suppliers'] });
        qc.invalidateQueries({ queryKey: ['branches'] });
        qc.invalidateQueries({ queryKey: ['purchase-orders'] });
        qc.invalidateQueries({ queryKey: ['customers'] });
        qc.invalidateQueries({ queryKey: ['products'] });
      }
    } catch (err) {
      // syncPendingMutations() already handles per-mutation connectivity
      // failures internally (leaving them queued for the next pass) — landing
      // here means something unexpected broke (e.g. an IndexedDB error), which
      // is worth surfacing rather than silently swallowing forever.
      console.error('syncPendingMutations failed unexpectedly:', err);
    }
  }, [qc]);

  useEffect(() => {
    void syncPending();
    void refreshCache();

    const interval = setInterval(() => { void syncPending(); }, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isSyncing: false, lastSynced: null as number | null, syncNow: refreshCache };
}
