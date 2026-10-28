import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { kitchenStationsApi } from '../../api';
import { useHardwareStore } from '../../stores/hardwareStore';
import { resolveReceiptPrintMode } from '../../lib/hardware/printer';
import type { KitchenStation } from '../../hooks/useKitchenStations';

// Hardware → Kitchen Printer, "Stations": the places order tickets print —
// Grill, Bar, Pizza, Main Kitchen — one list for every till. Each product
// picks its station (Products → Kitchen Printer); each till picks which of
// its own printers prints each station.

export default function KitchenStationsCard({ stations, isLoading, loadError, onRetry }: {
  stations: KitchenStation[];
  isLoading: boolean;
  /** The list couldn't be fetched (and this till has no copy of it). */
  loadError: boolean;
  onRetry: () => void;
}) {
  const hw = useHardwareStore();
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const save = useMutation({
    mutationFn: ({ id, ...data }: { id?: number; name?: string; is_default?: boolean }) =>
      id ? kitchenStationsApi.update(id, data) : kitchenStationsApi.create(data),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: ['kitchen-stations'] });
      if (!vars.id) setNewName('');
      setEditing(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Could not save station'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => kitchenStationsApi.delete(id),
    onSuccess: (_result, id) => {
      // This till forgets it too (other tills drop it when they next print).
      hw.update({
        kitchenPrinters: hw.kitchenPrinters.map((p) => ({ ...p, stationIds: (p.stationIds ?? []).filter((s) => s !== id) })),
        kitchenStationIds: hw.kitchenStationIds.filter((s) => s !== id),
      });
      qc.invalidateQueries({ queryKey: ['kitchen-stations'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      toast.success('Station removed');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Could not remove station'),
  });

  // The printers on this till that print a station's tickets, and whether
  // one goes by category (and so prints the items of the stations it doesn't).
  const choosing = resolveReceiptPrintMode(hw.kitchenPrinterMode) === 'system';
  const printersHere = (id: number): string[] => {
    if (choosing) return hw.kitchenPrinters.filter((p) => p.stationIds?.includes(id)).map((p) => p.name);
    return hw.kitchenStationIds.includes(id) ? [hw.kitchenPrinterName || 'this till’s kitchen printer'] : [];
  };
  const byCategory = choosing
    ? hw.kitchenPrinters.length === 0 || hw.kitchenPrinters.some((p) => !p.stationIds?.length)
    : hw.kitchenStationIds.length === 0;

  const handleRemove = (s: KitchenStation) => {
    const count = s.products_count ?? 0;
    const products = count === 0 ? '' : ` Its ${count} product${count === 1 ? '' : 's'} will print at the default station.`;
    if (confirm(`Remove "${s.name}"?${products}`)) remove.mutate(s.id);
  };

  const add = () => { if (newName.trim()) save.mutate({ name: newName.trim() }); };

  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Stations</h3>
      <p className="text-xs text-gray-500 mb-4">
        The places order tickets print — e.g. Grill, Bar, Pizza, Main Kitchen — shared by every till.
        Choose one on each product (Products → Kitchen Printer), then choose which printer prints each station on each till.
        Products with no station print at the default station; with no default, they go by category, as before.
      </p>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-gray-400 py-3"><Loader2 size={14} className="animate-spin" />Loading stations…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600 py-2">
          Couldn't load the stations — check the connection to the server.{' '}
          <button type="button" onClick={onRetry} className="font-medium underline">Try again</button>
        </p>
      ) : stations.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">No stations yet — every kitchen printer prints by category.</p>
      ) : (
        <div className="space-y-2">
          {stations.map((s) => {
            const here = printersHere(s.id);
            return (
              <div key={s.id} className="border border-gray-100 rounded-md p-3">
                {editing?.id === s.id ? (
                  <div className="flex gap-2">
                    <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && editing.name.trim()) save.mutate({ id: s.id, name: editing.name.trim() });
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      className="flex-1 min-w-0 border border-blue-400 rounded-md px-3 py-1.5 text-sm" />
                    <button type="button" disabled={!editing.name.trim() || save.isPending} onClick={() => save.mutate({ id: s.id, name: editing.name.trim() })}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className="px-2 py-1.5 text-gray-500 hover:bg-gray-100 rounded-md"><X size={14} /></button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                        {s.is_default && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">
                            <Star size={11} className="fill-blue-700" />Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {s.products_count ?? 0} product{s.products_count === 1 ? '' : 's'}{s.is_default ? ', plus those with no station' : ''}
                      </p>
                      {hw.kitchenPrinterEnabled && (here.length > 0
                        ? <p className="text-xs text-green-700 mt-0.5">On this till: {here.join(', ')}</p>
                        : <p className="text-xs text-amber-600 mt-0.5">
                            {byCategory ? 'No printer on this till is for it — its items go by category here' : 'Not printed on this till'}
                          </p>)}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button type="button" disabled={save.isPending} onClick={() => save.mutate({ id: s.id, is_default: !s.is_default })}
                        className="px-2.5 py-1.5 text-xs text-gray-600 rounded-md hover:bg-gray-100 disabled:opacity-50">
                        {s.is_default ? 'Not default' : 'Make default'}
                      </button>
                      <button type="button" onClick={() => setEditing({ id: s.id, name: s.name })}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 rounded-md hover:bg-gray-100"><Pencil size={12} />Rename</button>
                      <button type="button" disabled={remove.isPending} onClick={() => handleRemove(s)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-500 rounded-md hover:bg-red-50 disabled:opacity-50"><Trash2 size={12} />Remove</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="New station, e.g. Grill" maxLength={100}
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <button type="button" disabled={!newName.trim() || save.isPending} onClick={add}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 disabled:opacity-50">
          {save.isPending && !save.variables?.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add
        </button>
      </div>
    </div>
  );
}
