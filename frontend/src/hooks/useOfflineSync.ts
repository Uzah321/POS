/**
 * useOfflineSync — local-only POS build
 *
 * Returns the current local-server health state. There is no remote server
 * and no sync queue, so this hook is now a thin wrapper around offlineStore.
 * Call-sites that destructure { isOnline } continue to work unchanged.
 */
import { useOfflineStore } from '../stores/offlineStore';

export function useOfflineSync() {
  const isOnline   = useOfflineStore((s) => s.isOnline);
  const isSyncing  = false;
  const queue: never[] = [];

  return { isOnline, isSyncing, queue, syncQueue: async () => {} };
}

