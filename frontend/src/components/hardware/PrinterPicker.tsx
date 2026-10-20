import { useEffect, useState } from 'react';
import { Cable, Loader2, RefreshCw, Star } from 'lucide-react';
import type { ChosenPrinter } from '../../stores/hardwareStore';
import { isSystemPrintAvailable, listPrinters, type AvailablePrinter } from '../../lib/hardware/printer';
import CoreBridgeCard from './CoreBridgeCard';

// Hardware → Receipt / Kitchen Printer, "Choose Printers": every printer
// Windows has installed on this computer, to tick as many as should print
// bills (or kitchen tickets). A kitchen printer can take only some
// categories, e.g. drinks to the bar printer and food to the kitchen.

interface Props {
  role: 'receipt' | 'kitchen';
  chosen: ChosenPrinter[];
  onChange: (chosen: ChosenPrinter[]) => void;
  /** Kitchen printers: the categories each can be limited to. */
  categories?: Array<{ id: number; name: string }>;
  /** Printers ticked for the other role, to say so on the row. */
  otherRole?: ChosenPrinter[];
}

const PAPER_LABEL: Record<ChosenPrinter['paper'], string> = { '58mm': '58 mm roll', '80mm': '80 mm roll', a4: 'A4 page' };

export default function PrinterPicker({ role, chosen, onChange, categories = [], otherRole = [] }: Props) {
  const desktop = isSystemPrintAvailable();
  const [printers, setPrinters] = useState<AvailablePrinter[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => listPrinters()
    .then((found) => {
      setPrinters(found);
      setError(found.length === 0 ? "Windows has no printers installed on this computer — install or pair the printer in Windows first, then press Refresh list." : null);
    })
    .catch((e: unknown) => {
      setPrinters(null);
      setError(e instanceof Error ? e.message : 'Could not list printers');
    })
    .finally(() => setLoading(false));
  const refresh = () => {
    setLoading(true);
    setError(null);
    void load();
  };
  useEffect(() => { void load(); }, []);

  const pick = (name: string) => chosen.find((c) => c.name === name);
  const toggle = (name: string) => onChange(pick(name)
    ? chosen.filter((c) => c.name !== name)
    : [...chosen, { name, paper: '80mm', categoryIds: [] }]);
  const patch = (name: string, change: Partial<ChosenPrinter>) =>
    onChange(chosen.map((c) => (c.name === name ? { ...c, ...change } : c)));
  const toggleCategory = (p: ChosenPrinter, id: number) => patch(p.name, {
    categoryIds: p.categoryIds.includes(id) ? p.categoryIds.filter((c) => c !== id) : [...p.categoryIds, id],
  });

  // Ticked printers this computer doesn't (or doesn't yet) list stay on show, so they can be unticked.
  const rows: AvailablePrinter[] = [
    ...(printers ?? []),
    ...chosen.filter((c) => !printers?.some((p) => p.name === c.name)).map((c) => ({ name: c.name, displayName: c.name, isDefault: false })),
  ];
  const found = (name: string) => printers?.some((p) => p.name === name) ?? true;

  return (
    <div>
      {!desktop && <CoreBridgeCard use="printers" onRunning={() => { if (error) void refresh(); }} />}

      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-600">
          {role === 'receipt'
            ? 'Tick every printer that should print the bills — each bill prints on all of them.'
            : 'Tick every printer that should get kitchen orders — each order prints on all of them that take any of its items.'}
        </p>
        <button onClick={() => void refresh()} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-60 flex-shrink-0">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Looking…' : 'Refresh list'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      {loading && !printers && <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-3"><Loader2 size={13} className="animate-spin" />Looking for printers…</p>}

      <div className="space-y-2">
        {rows.map((p) => {
          const c = pick(p.name);
          const also = otherRole.some((o) => o.name === p.name);
          return (
            <div key={p.name} className={`rounded-md border p-3 ${c ? 'border-blue-300 bg-blue-50' : 'border-gray-100'}`}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={!!c} onChange={() => toggle(p.name)} className="w-4 h-4 accent-blue-600 flex-shrink-0" />
                <Cable size={15} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.displayName}</p>
                  <div className="flex flex-wrap gap-x-3 text-xs">
                    {p.isDefault && <span className="text-gray-400">Windows default printer</span>}
                    {p.offline && <span className="text-amber-600">Windows says it's offline</span>}
                    {!found(p.name) && <span className="text-red-600">Not found on this computer</span>}
                    {also && <span className="text-gray-500">{role === 'receipt' ? 'Also a kitchen printer' : 'Also prints the bills'}</span>}
                  </div>
                </div>
                {c && <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 flex-shrink-0"><Star size={13} className="fill-blue-700" />{role === 'receipt' ? 'Bills' : 'Kitchen'}</span>}
              </label>

              {c && (
                <div className="mt-3 pl-7 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Paper</span>
                    {(['58mm', '80mm', ...(desktop && role === 'receipt' ? ['a4' as const] : [])] as ChosenPrinter['paper'][]).map((size) => (
                      <button key={size} type="button" onClick={() => patch(p.name, { paper: size })}
                        className={`px-2.5 py-1 rounded-md border font-medium ${c.paper === size ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                        {PAPER_LABEL[size]}
                      </button>
                    ))}
                  </div>
                  {role === 'kitchen' && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-gray-500 mr-1">Prints</span>
                      <button type="button" onClick={() => patch(p.name, { categoryIds: [] })}
                        className={`px-2.5 py-1 rounded-full border font-semibold ${c.categoryIds.length === 0 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                        All items
                      </button>
                      {categories.map((cat) => (
                        <button key={cat.id} type="button" onClick={() => toggleCategory(c, cat.id)}
                          className={`px-2.5 py-1 rounded-full border font-semibold ${c.categoryIds.includes(cat.id) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {chosen.length === 0 && rows.length > 0 && (
        <p className="text-xs text-amber-600 mt-3">
          {role === 'receipt' ? 'No printer ticked yet — bills open the print dialog until you tick one.' : 'No printer ticked yet — kitchen tickets open the print dialog until you tick one.'}
        </p>
      )}
      {!desktop && (
        <p className="text-xs text-gray-400 mt-3">
          From a browser, tickets go to the printer in the receipt-printer language thermal printers use (ESC/POS), so tick receipt / kitchen thermal printers.
          An office printer (A4) can't print these — use the System Print Dialog mode for one.
        </p>
      )}
    </div>
  );
}
