/**
 * offlineStore — local-only POS build
 *
 * The only state tracked here is whether the local PHP server is reachable.
 * The sale queue and sync machinery have been removed because everything runs
 * on a local server (127.0.0.1:8080) — there is no remote server to sync to.
 */
import { create } from 'zustand';

interface OfflineState {
  /** True when the local PHP server is responding on 127.0.0.1:8080 */
  isOnline: boolean;
  setOnline: (v: boolean) => void;

  // ─── Legacy stubs kept so existing call-sites compile without changes ──────
  queue: never[];
  isSyncing: boolean;
  enqueue: () => string;
  dequeue: () => void;
  markAttempt: () => void;
  setSyncing: (v: boolean) => void;
}

export const useOfflineStore = create<OfflineState>()((set) => ({
  isOnline: true,   // optimistic — useServerHealth corrects within seconds
  queue: [],
  isSyncing: false,

  setOnline: (v) => set({ isOnline: v }),

  // No-ops: local-only build has no queue
  enqueue: () => '',
  dequeue: () => {},
  markAttempt: () => {},
  setSyncing: () => {},
}));

// Legacy type alias kept so imports of PendingSale still compile
export type PendingSale = never;

