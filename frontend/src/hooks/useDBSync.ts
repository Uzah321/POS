import { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { productsApi, customersApi } from '../api';
import { db } from '../lib/db';
import { useOfflineStore } from '../stores/offlineStore';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function useDBSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const isOnline = useOfflineStore((s) => s.isOnline);

  const syncNow = useCallback(async (silent = false) => {
    if (isSyncing || !navigator.onLine) return;
    setIsSyncing(true);
    try {
      const [products, customers] = await Promise.all([
        productsApi.list({ per_page: 500, is_active: 1 }).then(r => r.data?.data?.data ?? r.data?.data ?? []),
        customersApi.list({ per_page: 500 }).then(r => r.data?.data?.data ?? []),
      ]);

      await db.transaction('rw', db.products, db.customers, db.syncMeta, async () => {
        await db.products.clear();
        await db.products.bulkPut(products);
        await db.customers.clear();
        await db.customers.bulkPut(customers);
        await db.syncMeta.put({ key: 'last_sync', synced_at: Date.now() });
      });

      const now = Date.now();
      setLastSynced(now);
      if (!silent) {
        toast.success(`Offline database synced — ${products.length} products, ${customers.length} customers`);
      }
    } catch (err: any) {
      if (!silent) toast.error('Sync failed: ' + (err?.message ?? 'Unknown error'));
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  useEffect(() => {
    db.syncMeta.get('last_sync').then(meta => {
      if (meta) setLastSynced(meta.synced_at);
    });
  }, []);

  // Auto-sync on mount or when we come back online, if data is stale
  useEffect(() => {
    if (!isOnline) return;
    db.syncMeta.get('last_sync').then(meta => {
      const stale = !meta || (Date.now() - meta.synced_at) > SYNC_INTERVAL_MS;
      if (stale) void syncNow(true);
    });
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isSyncing, lastSynced, syncNow };
}
