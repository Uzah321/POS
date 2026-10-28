import { useQuery } from '@tanstack/react-query';
import { kitchenStationsApi } from '../api';

/** Where a product's kitchen ticket prints — Grill, Bar, Pizza… (products.kitchen_station_id). */
export interface KitchenStation {
  id: number;
  name: string;
  /** Takes the products that don't name a station. */
  is_default: boolean;
  products_count?: number;
}

const CACHE_KEY = 'Core-kitchen-stations-cache';

/**
 * The kitchen stations, shared by every till. The last list fetched is kept
 * on this device, so an offline till still routes tickets the same way.
 */
export function useKitchenStations() {
  return useQuery<KitchenStation[]>({
    queryKey: ['kitchen-stations'],
    queryFn: async () => {
      try {
        const data = await kitchenStationsApi.list().then((r) => r.data?.data ?? []);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage blocked: no offline copy */ }
        return data;
      } catch (error) {
        let cached: string | null = null;
        try { cached = localStorage.getItem(CACHE_KEY); } catch { /* storage blocked */ }
        if (cached) return JSON.parse(cached);
        throw error;
      }
    },
    staleTime: 60000,
  });
}
