import { useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { salesApi } from '../api';
import { useOfflineStore } from '../stores/offlineStore';

// Module-level flag — prevents concurrent syncs even if the hook is mounted in multiple components
let _syncing = false;

export function useOfflineSync() {
  const { setOnline, dequeue, markAttempt, setSyncing } = useOfflineStore();

  const syncQueue = useCallback(async () => {
    if (_syncing) return;
    const queue = useOfflineStore.getState().queue;
    if (queue.length === 0) return;

    _syncing = true;
    setSyncing(true);

    let synced = 0;
    let failed = 0;

    for (const sale of queue) {
      try {
        await salesApi.create({ ...sale.payload, is_offline: true });
        dequeue(sale.localId);
        synced++;
      } catch (err: any) {
        const msg = err.response?.data?.message ?? err.message ?? 'Unknown error';
        markAttempt(sale.localId, msg);
        failed++;
      }
    }

    setSyncing(false);
    _syncing = false;

    if (synced > 0) toast.success(`Synced ${synced} offline sale${synced !== 1 ? 's' : ''} to server`);
    if (failed > 0) toast.error(`${failed} sale${failed !== 1 ? 's' : ''} failed to sync — will retry when online`);
  }, [dequeue, markAttempt, setSyncing]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Sync any queued sales that accumulated before this component mounted
    if (navigator.onLine) {
      void syncQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline, syncQueue]);

  return {
    isOnline: useOfflineStore((s) => s.isOnline),
    queue: useOfflineStore((s) => s.queue),
    isSyncing: useOfflineStore((s) => s.isSyncing),
    syncQueue,
  };
}
