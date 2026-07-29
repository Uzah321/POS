import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { registersApi } from '../api';

const STORAGE_KEY = 'core_register_id';

/**
 * Resolves which till (register) this browser/terminal is operating as, for
 * ZIMRA fiscalisation — each concurrently-operating till needs its own
 * registered fiscal device with independently sequential receipt numbers.
 *
 * Stays completely invisible for the common case (a branch with 0 or 1
 * registers configured): registerId resolves automatically and
 * needsSelection is always false. Only branches with >1 active register ever
 * see a selection prompt, and the choice then persists per-browser.
 */
export function useSelectedRegister(branchId: number | undefined) {
  const { data: registers } = useQuery({
    queryKey: ['registers', 'select', branchId],
    queryFn: () => registersApi.list({ branch_id: branchId }).then(r => (r.data?.data ?? []) as any[]),
    enabled: !!branchId,
    staleTime: 60_000,
  });

  const activeRegisters = useMemo(() => (registers ?? []).filter(r => r.is_active), [registers]);

  const [storedId, setStoredId] = useState<number | undefined>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) : undefined;
  });

  useEffect(() => {
    if (storedId != null) localStorage.setItem(STORAGE_KEY, String(storedId));
  }, [storedId]);

  const registerId = useMemo(() => {
    if (activeRegisters.length === 0) return undefined;
    if (activeRegisters.length === 1) return activeRegisters[0].id;
    return activeRegisters.some(r => r.id === storedId) ? storedId : undefined;
  }, [activeRegisters, storedId]);

  return {
    registerId,
    registers: activeRegisters,
    needsSelection: activeRegisters.length > 1 && registerId == null,
    selectRegister: (id: number) => setStoredId(id),
  };
}
