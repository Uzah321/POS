import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../api';
import {
  Loader2, Save, Building2, ShoppingCart, Package, Landmark, Barcode, Scale, Image as ImageIcon, Trash2, Percent, Receipt as ReceiptIcon,
  type LucideIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchAllProducts } from '../lib/productSearch';
import FiscalisationPanel from '../components/FiscalisationPanel';
import ReceiptOptionsCard from '../components/ReceiptOptionsCard';
import { useLocation } from 'react-router-dom';
import PageTabs from '../components/PageTabs';
import { rememberTab, tabFromHash } from '../lib/pageTabs';
import { RECEIPT_OPTIONS } from '../lib/receiptOptions';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import { companyLogo, logoFileToDataUrl } from '../lib/companyLogo';
import {
  DIGI_SM110_LAYOUTS, LABEL_ROUNDING_OPTIONS, embeddedCartLine, layoutEnabled, layoutFlag, normalizePlu, priceLabelsReadAsWeight, readScaleLabel, resolveEmbeddedBarcode,
  scaleLayoutSettings, singleReading, switchedLayoutSettings, switchedLayoutsEnabled, type ScaleBarcodeLayout,
} from '../lib/barcode/embeddedBarcode';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors focus:outline-none ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

const field = 'w-full border border-gray-200 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';

/** One card of settings, under a heading. */
function Section({ icon: Icon, title, bodyClassName = 'p-6', children }: { icon: LucideIcon; title: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
          <Icon size={16} className="text-blue-600" />
        </div>
        <h2 className="font-semibold text-gray-900">{title}</h2>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

// The page's tabs. Their key is also the #hash that opens one
// (Hardware links to /settings#receipts).
const SETTINGS_TABS = ['business', 'tax', 'register', 'inventory', 'receipts', 'barcodes'] as const;
type SettingsTab = typeof SETTINGS_TABS[number];

/** The tab a setting is changed on, to mark tabs with changes not saved yet. */
function tabOf(key: string): SettingsTab | undefined {
  if (key === 'tax_enabled' || key === 'tax_rate') return 'tax';
  if (key.startsWith('company_')) return 'business';
  if (key.startsWith('barcode_')) return 'barcodes';
  if (['low_stock_alerts', 'block_negative_stock', 'low_stock_threshold'].includes(key)) return 'inventory';
  if (['loyalty_enabled', 'multi_currency_enabled', 'require_table_number', 'pos_tile_theme', 'receipt_auto_print'].includes(key)) return 'register';
  if (key.startsWith('receipt_')) return 'receipts';
  return undefined;
}

// The company logo for receipts / tax invoices and quotation and purchase
// order PDFs. Held with the other fields until Save Changes.
function CompanyLogoField({ value, onChange }: { value?: string; onChange: (logo: string) => void }) {
  const [reading, setReading] = useState(false);
  const logo = companyLogo({ company_logo: value });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      onChange(await logoFileToDataUrl(file));
      toast.success('Logo added — Save Changes to keep it');
    } catch {
      toast.error('Could not read that image — try a PNG or JPG');
    } finally {
      setReading(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">Company Logo</label>
      <div className="flex items-center gap-4">
        <div className="w-36 h-20 flex-shrink-0 border border-gray-200 rounded-md bg-gray-50 flex items-center justify-center overflow-hidden">
          {logo ? <img src={logo} alt="Company logo" className="max-w-full max-h-full object-contain" /> : <ImageIcon size={22} className="text-gray-300" />}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <label className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-600 text-xs font-semibold cursor-pointer hover:bg-blue-100 transition-colors">
              {reading ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
              {logo ? 'Change logo' : 'Add logo'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {logo && (
              <button type="button" onClick={() => onChange('')} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors">
                <Trash2 size={13} /> Remove logo
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">Printed at the top of receipts / tax invoices, and on quotation and purchase order PDFs. A simple black-and-white logo prints best on a receipt printer.</p>
        </div>
      </div>
    </div>
  );
}

// Text (not number) inputs on purpose — a prefix/position/length is a digit
// string where a leading zero matters (e.g. prefix "02" vs "2"); a <input
// type="number"> would silently strip it.
function DigitField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors"
      />
    </div>
  );
}

// Fills the Random Weight / Random Price fields below from a DIGI SM-110
// label scale's own barcode setup, rather than counting digit positions by
// hand — the layout, flag and price-or-weight choice are all things the
// scale's programming (or its technician) can tell you.
function ScaleLabelPreset({ onApply }: { onApply: (kind: 'weight' | 'price', layout: ScaleBarcodeLayout, flag: string) => void }) {
  const [kind, setKind] = useState<'weight' | 'price'>('price');
  const [spec, setSpec] = useState(4);
  const [flag, setFlag] = useState('20');
  const layout = DIGI_SM110_LAYOUTS.find((l) => l.spec === spec) ?? DIGI_SM110_LAYOUTS[0];
  const flagOk = /^\d+$/.test(flag) && flag.length <= layout.flagLength;
  const select = 'w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Scale size={15} className="text-blue-600" />
        <p className="text-sm font-semibold text-gray-900">DIGI SM-110 label scale</p>
      </div>
      <p className="text-xs text-gray-500">
        The scale prints a barcode on each label; the till scans it. Pick the barcode layout the scale is programmed with (its SPEC 00), what it puts in the barcode (SPEC 01) and its flag digits (usually 20), then press Apply and scan a label below to check.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_80px_auto] gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Barcode carries</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'weight' | 'price')} className={select}>
            <option value="price">Price</option>
            <option value="weight">Weight</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Barcode layout</label>
          <select
            value={spec}
            onChange={(e) => {
              const next = DIGI_SM110_LAYOUTS.find((l) => l.spec === Number(e.target.value)) ?? DIGI_SM110_LAYOUTS[0];
              setSpec(next.spec);
              setFlag((f) => f.slice(0, next.flagLength));
            }}
            className={`${select} font-mono`}
          >
            {DIGI_SM110_LAYOUTS.map((l) => <option key={l.spec} value={l.spec}>{l.spec} — {l.pattern}</option>)}
          </select>
        </div>
        <DigitField label="Flag" value={flag} onChange={(e) => setFlag(e.target.value.trim())} placeholder={layout.flagLength === 2 ? '20' : '2'} />
        <button
          type="button"
          disabled={!flagOk}
          onClick={() => onApply(kind, layout, flag.padStart(layout.flagLength, '0'))}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md disabled:opacity-50"
        >
          Apply
        </button>
      </div>
      {!flagOk && flag !== '' && (
        <p className="text-xs text-red-600">This layout has a {layout.flagLength}-digit flag.</p>
      )}
    </div>
  );
}

// Scan (or type) a real label and see what the till would make of it —
// decoded against the fields as they are on screen, before saving, so the
// layout can be tried and corrected label in hand. When the fields don't
// read it right, the label's own check digits usually say which layout the
// scale prints, and one press fills the fields in.
type ApplyLayout = (kind: 'weight' | 'price', layout: ScaleBarcodeLayout, flag: string) => void;
type ReadAs = (kind: 'weight' | 'price', flag?: string) => void;

function ScaleLabelTest({ settings, onApply, onReadAs }: {
  settings: Record<string, unknown>;
  onApply: ApplyLayout;
  /** Read the scale's labels the other way round: their digits a price, not a weight, or back. */
  onReadAs: ReadAs;
}) {
  const user = useAuthStore((s) => s.user);
  const { format: formatCurrency } = useCurrencyStore();
  const [code, setCode] = useState('');
  const trimmed = code.trim();

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ['plu-check-products', user?.branch?.id],
    queryFn: () => fetchAllProducts({ is_active: 1, branch_id: user?.branch?.id }),
    enabled: trimmed !== '',
  });
  const label = trimmed && !isLoading ? resolveEmbeddedBarcode(trimmed, settings, products) : null;
  const decoded = label?.decoded;
  const product = label?.product;
  const line = decoded && product ? embeddedCartLine(decoded, parseFloat(product.selling_price), settings) : null;
  const applyButton = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md';
  // The label read another way. A scale switched from printing the weight in
  // its barcode to printing the price (or back) keeps its layout: its new
  // labels still read, wrongly, as the old kind. Or it gives them a flag of
  // their own, which nothing reads yet.
  const alt: { kind: 'weight' | 'price'; flag?: string } | null =
    decoded && product && !label?.layout ? { kind: decoded.kind === 'weight' ? 'price' : 'weight' }
    : !label && trimmed && !isLoading && layoutEnabled(settings, 'barcode_weight') ? { kind: 'price', flag: trimmed.slice(0, layoutFlag(settings, 'weight').length) }
    : null;
  const altSettings = alt ? { ...settings, ...switchedLayoutSettings(settings, alt.kind, alt.flag), ...switchedLayoutsEnabled(settings, alt.kind, alt.flag) } : null;
  const altLabel = altSettings ? resolveEmbeddedBarcode(trimmed, altSettings, products) : null;
  const altLine = altLabel?.product && altSettings ? embeddedCartLine(altLabel.decoded, parseFloat(altLabel.product.selling_price), altSettings) : null;
  const altNote = alt && altLabel?.product && altLine ? (
    <div className="flex flex-wrap items-center gap-2 text-gray-500">
      <span>
        {alt.flag
          ? `Starts with ${alt.flag}: a scale label with a price in its barcode, under a flag of its own?`
          : `Label prints ${alt.kind === 'price' ? 'a price' : 'a weight'} in its barcode instead?`}
        {' '}Read that way, it's {altLabel.decoded.kind === 'price' ? formatCurrency(altLabel.decoded.value) : `${altLabel.decoded.value.toFixed(3)} kg`}
        {' '}({altLabel.product.name}{altLine.soldByWeight ? `, ${altLine.qty.toFixed(3)} kg` : ''} = {formatCurrency((altLine.price ?? parseFloat(altLabel.product.selling_price)) * altLine.qty)}).
      </span>
      <button type="button" className={applyButton} onClick={() => onReadAs(alt.kind, alt.flag)}>
        Read {alt.flag ? `${alt.flag} labels` : 'labels'} as {alt.kind === 'price' ? 'prices' : 'weights'}
      </button>
    </div>
  ) : null;
  // What the label says by itself, for when the fields above don't get to a product.
  const reading = trimmed && !isLoading && !product ? singleReading(readScaleLabel(trimmed, products)) : null;
  const layoutName = (l: ScaleBarcodeLayout) => <>layout {l.spec} (<span className="font-mono">{l.pattern}</span>)</>;

  return (
    <div className="border-t border-gray-100 pt-5">
      <label className="block text-sm font-semibold text-gray-900 mb-1">Test a label</label>
      <p className="text-xs text-gray-400 mb-2">Click in the box and scan a label from the scale (or type the digits under its barcode).</p>
      <input
        type="text"
        inputMode="numeric"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        onFocus={(e) => e.target.select()}
        placeholder="e.g. 2000012064356"
        className={`${field} font-mono`}
      />
      {trimmed && (
        <div className="mt-2 text-sm space-y-2">
          {isLoading ? (
            <p className="text-gray-400 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Looking up products…</p>
          ) : decoded && product && line ? (
            <div className="space-y-1">
              <p className="text-gray-700">
                {decoded.kind === 'price' ? 'Price' : 'Weight'} label · PLU <span className="font-mono">{decoded.pluCode}</span> ·{' '}
                <span className="font-semibold">{decoded.kind === 'price' ? formatCurrency(decoded.value) : `${decoded.value.toFixed(3)} kg`}</span>
                <span className="text-gray-400"> — should match what's printed on the label</span>
              </p>
              <p className="text-green-700">
                Rings up as {product.name}
                {line.soldByWeight ? `, ${line.qty.toFixed(3)} kg` : ''}
                {' = '}{formatCurrency((line.price ?? parseFloat(product.selling_price)) * line.qty)}
              </p>
              {altNote}
              {label?.layout && (
                <div className="flex flex-wrap items-center gap-2 text-amber-700">
                  <span>Read from the label's own check digits as {layoutName(label.layout)} — the positions above don't match this label.</span>
                  <button type="button" className={applyButton} onClick={() => onApply(decoded.kind, label.layout!, trimmed.slice(0, label.layout!.flagLength))}>
                    Use layout {label.layout.spec}
                  </button>
                </div>
              )}
            </div>
          ) : reading ? (
            <div className="space-y-2">
              <p className="text-gray-700">
                {label?.conflict ? 'The positions above read this label as a different item. ' : ''}
                This label was printed with {layoutName(reading.layout)}, flag <span className="font-mono">{reading.flag}</span>, for{' '}
                <span className="font-semibold">{reading.product.name}</span>. Is the label's{' '}
                <span className="font-mono">{reading.digits}</span> a weight or a price?
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={applyButton} onClick={() => onApply('weight', reading.layout, reading.flag)}>
                  Weight — {(parseInt(reading.digits, 10) / 1000).toFixed(3)} kg
                </button>
                <button type="button" className={applyButton} onClick={() => onApply('price', reading.layout, reading.flag)}>
                  Price — {formatCurrency(parseInt(reading.digits, 10) / 100)}
                </button>
              </div>
            </div>
          ) : label?.conflict ? (
            <p className="text-red-600">The positions above and the label's check digits name different items, so the till won't ring this up. Pick the scale's layout in the box above.</p>
          ) : decoded ? (
            <p className="text-red-600">
              No product has PLU Code {normalizePlu(decoded.pluCode)} yet — tick Sold by weight on the product's page and set its PLU Code to {normalizePlu(decoded.pluCode)}.
            </p>
          ) : altNote ? (
            <div className="space-y-1">
              <p className="text-gray-700">Not read with the settings above.</p>
              {altNote}
            </div>
          ) : (
            <p className="text-red-600">
              Not recognised with the settings above{/^\d{2,}$/.test(trimmed) ? ` — this barcode starts with ${trimmed.slice(0, 2)}` : ''}. Check the flag and layout, that the matching toggle is on, and that the item has a PLU Code.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const isOn = (v: unknown) => v === true || v === 'true';
const isNotOff = (v: unknown) => v !== false && v !== 'false';

/** The page's switches as the settings have them (a missing one at its default). */
function readToggles(s: Record<string, unknown>) {
  return {
    tax_enabled: isOn(s.tax_enabled),
    loyalty_enabled: isOn(s.loyalty_enabled),
    multi_currency_enabled: isOn(s.multi_currency_enabled),
    receipt_auto_print: isOn(s.receipt_auto_print),
    low_stock_alerts: isNotOff(s.low_stock_alerts),
    require_table_number: isOn(s.require_table_number),
    block_negative_stock: isNotOff(s.block_negative_stock),
    barcode_weight_enabled: layoutEnabled(s, 'barcode_weight'),
    barcode_price_enabled: layoutEnabled(s, 'barcode_price'),
  };
}

const NO_SETTINGS: Record<string, string> = {};

export default function SettingsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // What's saved on the server, read afresh every time the page opens. The
  // form used to be filled only when this page's own fetch ran: opened within
  // 30 s of another screen reading settings, it showed every switch at its
  // default (Enable Tax off, no Tax Rate), and Save wrote those back. Not the
  // service worker's copy either (/settings/current isn't kept): on a slow
  // line that's an old one.
  const settingsQuery = useQuery({
    queryKey: ['settings', 'current'],
    queryFn: () => settingsApi.current().then((r) => (r.data?.data || {}) as Record<string, string>),
    refetchOnMount: 'always',
  });
  const saved = settingsQuery.data ?? NO_SETTINGS;
  const [openedAt] = useState(() => Date.now());
  const loaded = settingsQuery.dataUpdatedAt >= openedAt;

  // Only what's been changed on this page: all a save sends, so it can't put
  // back a setting changed elsewhere meanwhile, and a refetch in the
  // background (back to this tab, say) doesn't lose it.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const values = useMemo<Record<string, string>>(() => ({ ...saved, ...edits }), [saved, edits]);
  const toggles = useMemo(() => readToggles(values), [values]);
  // Settings > Receipts & Invoices: on/off per settings key, on unless saved off.
  const receiptShow = useMemo<Record<string, boolean>>(
    () => Object.fromEntries(RECEIPT_OPTIONS.map((o) => [o.setting, isNotOff(values[o.setting])])),
    [values],
  );
  const edit = (changes: Record<string, string | boolean>) =>
    setEdits((e) => ({ ...e, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, String(v)])) }));

  // One tab at a time. Changes on every tab are kept until Save Changes,
  // which saves them all; a dot marks each tab that has some.
  const [tab, setTab] = useState<SettingsTab>(() => tabFromHash(SETTINGS_TABS) ?? 'business');
  // A link to one of the tabs (/settings#receipts) followed while the page is open.
  // (A hash-only change keeps the location's key, so both are watched.)
  const location = useLocation();
  const here = `${location.key}${location.hash}`;
  const [seenLocation, setSeenLocation] = useState(here);
  if (here !== seenLocation) {
    setSeenLocation(here);
    const linked = SETTINGS_TABS.find((k) => `#${k}` === location.hash);
    if (linked) setTab(linked);
  }
  const openTab = (next: SettingsTab) => {
    setTab(next);
    rememberTab(next);
  };
  const unsavedTabs = useMemo(() => new Set(
    Object.entries(edits)
      .filter(([k, v]) => String(saved[k] ?? '') !== v)
      .map(([k]) => tabOf(k)),
  ), [edits, saved]);

  // ZIMRA's standard VAT rate on this store's fiscal device(s), if it has one.
  const { data: zimraRates = [] } = useQuery({
    queryKey: ['zimra-vat-rates'],
    queryFn: () => settingsApi.zimraVat().then((r) => (r.data?.data?.rates ?? []) as number[]),
    staleTime: 5 * 60 * 1000,
  });
  const zimraRateText = zimraRates.map((r) => `${r}%`).join(' or ');
  const taxRateNow = parseFloat(String(values.tax_rate ?? '').replace(',', '.'));
  const taxRateMatchesZimra = zimraRates.some((r) => Math.abs(r - taxRateNow) < 0.0001);

  // The changes, plus any switch the server has never had: it shows its
  // default here, and saving it means every till reads the same.
  const changesToSave = (): Record<string, string> => ({
    ...Object.fromEntries(
      [...Object.entries(toggles), ...Object.entries(receiptShow)]
        .filter(([k]) => saved[k] == null || saved[k] === '')
        .map(([k, v]) => [k, String(v)]),
    ),
    ...edits,
  });

  // Online only. A save queued offline used to replay the whole page as it
  // was then, putting back anything changed since.
  const mutation = useMutation({
    mutationFn: (changes: Record<string, string>) => settingsApi.update(changes),
    onSuccess: (res, changes) => {
      toast.success('Settings saved');
      const stored = (res.data?.data ?? changes) as Record<string, string>;
      qc.setQueryData<Record<string, string>>(['settings', 'current'], (old) => ({ ...(old ?? {}), ...stored }));
      // Anything changed again while this was saving stays to be saved.
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k, v]) => changes[k] !== v)));
      // Every page that reads settings (POS, Cashier, Dashboard, etc.) —
      // refetched now rather than after its staleTime.
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: unknown) => {
      const response = (err as { response?: { data?: { message?: string } } } | null)?.response;
      toast.error(
        response
          ? (response.data?.message ?? 'Settings were not saved')
          : "Couldn't reach the server, so nothing was saved. Check the connection and Save again.",
        { duration: 8000 },
      );
    },
  });

  const save = () => {
    const changes = changesToSave();
    if (Object.keys(changes).length === 0) {
      toast('Nothing has changed');
      return;
    }
    mutation.mutate(changes);
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    edit({ [key]: e.target.value });

  const applyScaleLayout = (kind: 'weight' | 'price', layout: ScaleBarcodeLayout, flag: string) => {
    // Two formats can't share a flag — weight is tried first when decoding,
    // so it would swallow every price label. Switch the other one off if its
    // flag overlaps.
    const otherPrefix = String(values[kind === 'weight' ? 'barcode_price_prefix' : 'barcode_weight_prefix'] ?? '');
    const clash = otherPrefix !== '' && (otherPrefix.startsWith(flag) || flag.startsWith(otherPrefix));
    edit({
      ...scaleLayoutSettings(layout, flag, kind),
      barcode_weight_enabled: kind === 'weight' || (!clash && toggles.barcode_weight_enabled),
      barcode_price_enabled: kind === 'price' || (!clash && toggles.barcode_price_enabled),
    });
    toast.success('Filled in — scan a label to check it, then Save Changes');
  };

  // The scale now prints the price in its barcode instead of the weight (or
  // back), in the same layout: the other layout takes its positions, under
  // the same flag (that layout then goes off, as it would be read first) or
  // the new labels' own (both stay on, so labels already printed still read).
  const readLabelsAs: ReadAs = (kind, flag) => {
    const all = { ...values, ...toggles };
    const fromFlag = layoutFlag(all, kind === 'price' ? 'weight' : 'price');
    const onOff = switchedLayoutsEnabled(all, kind, flag);
    edit({ ...switchedLayoutSettings(all, kind, flag), ...onOff });
    const what = (k: 'weight' | 'price') => (k === 'price' ? 'prices' : 'weights');
    const old = kind === 'price' ? 'weight' : 'price';
    toast.success(
      (kind === 'price' ? onOff.barcode_weight_enabled : onOff.barcode_price_enabled)
        ? `Labels starting ${flag} will be read as ${what(kind)}, and those starting ${fromFlag} still as ${what(old)}, once you Save Changes.`
        : `Labels starting ${fromFlag} will be read as ${what(kind)} once you Save Changes. Packs already labelled with a ${old} would ring up wrong, so re-label them.`,
      { duration: 8000 },
    );
  };

  if (!loaded && settingsQuery.isError && !settingsQuery.isFetching) return (
    <div className="max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-semibold">Couldn't load your settings</p>
      <p className="mt-1">The server didn't answer, so they can't be shown or changed right now. Check the connection and try again.</p>
      <button
        type="button"
        onClick={() => settingsQuery.refetch()}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );

  if (!loaded) return (
    <div className="flex justify-center py-16">
      <Loader2 size={28} className="animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-400 text-sm mt-0.5">Configure your Core</p>
        </div>
        <div className="flex items-center gap-3">
          {unsavedTabs.size > 0 && <span className="text-xs font-medium text-amber-700">Changes not saved yet</span>}
          <button
            type="button"
            onClick={save}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-md text-sm shadow-md shadow-blue-100 transition-colors disabled:opacity-60"
          >
            {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save Changes
          </button>
        </div>
      </div>

      <PageTabs
        label="Settings"
        active={tab}
        onChange={openTab}
        tabs={[
          { key: 'business', label: 'Business', icon: Building2 },
          { key: 'tax', label: 'Tax & ZIMRA', icon: Landmark },
          { key: 'register', label: 'Register', icon: ShoppingCart },
          { key: 'inventory', label: 'Inventory', icon: Package },
          { key: 'receipts', label: 'Receipts', icon: ReceiptIcon },
          { key: 'barcodes', label: 'Barcodes', icon: Barcode },
        ].map((t) => ({ ...t, key: t.key as SettingsTab, unsaved: unsavedTabs.has(t.key as SettingsTab) }))}
      />

      {tab === 'business' && (
        <Section icon={Building2} title="Business Profile">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Business Name</label>
              <input value={values.company_name ?? ''} onChange={set('company_name')} placeholder="Core" className={field} />
            </div>
            <div className="sm:col-span-2">
              <CompanyLogoField value={values.company_logo} onChange={(logo) => edit({ company_logo: logo })} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Phone Number</label>
              <input value={values.company_phone ?? ''} onChange={set('company_phone')} placeholder="+1 555 000 0000" className={field} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
              <input type="email" value={values.company_email ?? ''} onChange={set('company_email')} placeholder="store@diapermart.com" className={field} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Business Address</label>
              <textarea value={values.company_address ?? ''} onChange={set('company_address')} rows={2} placeholder="123 Main Street, City, Country" className={`${field} resize-none`} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">VAT / Tax Number</label>
              <input value={values.company_vat_number ?? ''} onChange={set('company_vat_number')} placeholder="4012345678" className={field} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">TIN Number</label>
              <input value={values.company_tin_number ?? ''} onChange={set('company_tin_number')} placeholder="2000231759" className={field} />
            </div>
          </div>
        </Section>
      )}

      {tab === 'tax' && (
        <>
          <Section icon={Percent} title="Tax" bodyClassName="px-6 py-2">
            <ToggleRow
              label="Enable Tax"
              description="Work out the VAT inside your prices on every sale, for the receipt's VAT breakdown, reports and fiscal receipts. Prices already include VAT, so totals don't change."
              checked={toggles.tax_enabled}
              onChange={(v) => edit({ tax_enabled: v })}
            />
            <div className="py-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tax Rate (%)</label>
              <input type="number" step="any" min="0" max="100" inputMode="decimal" value={values.tax_rate ?? ''} onChange={set('tax_rate')} placeholder="15.5" className={`${field} sm:max-w-xs`} />
              {zimraRates.length > 0 && (
                !toggles.tax_enabled ? (
                  <p className="mt-1.5 text-xs text-amber-700">
                    Enable Tax is off, so fiscal receipts go to ZIMRA zero-rated, at 0%. Your fiscal device's standard rate is {zimraRateText}.
                  </p>
                ) : taxRateMatchesZimra ? (
                  <p className="mt-1.5 text-xs text-green-700">The same as the standard rate on your ZIMRA fiscal device.</p>
                ) : (
                  <p className="mt-1.5 text-xs text-amber-700">
                    Your fiscal device records VAT with ZIMRA at {zimraRateText}.{' '}
                    <button type="button" onClick={() => edit({ tax_rate: String(zimraRates[0]) })} className="font-semibold underline">
                      Use {zimraRates[0]}%
                    </button>
                  </p>
                )
              )}
            </div>
          </Section>

          <Section icon={Landmark} title="ZIMRA Fiscalisation">
            <FiscalisationPanel />
          </Section>
        </>
      )}

      {tab === 'register' && (
        <Section icon={ShoppingCart} title="Register Preferences" bodyClassName="px-6 py-2">
          <ToggleRow
            label="Loyalty Points"
            description="Allow customers to earn and redeem points"
            checked={toggles.loyalty_enabled}
            onChange={(v) => edit({ loyalty_enabled: v })}
          />
          <ToggleRow
            label="Multi-Currency"
            description="Support multiple currencies at checkout"
            checked={toggles.multi_currency_enabled}
            onChange={(v) => edit({ multi_currency_enabled: v })}
          />
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Receipt Printing</p>
            <p className="text-sm text-gray-600 mt-1">Every completed order prints a receipt. Choose the receipt printer mode from the Hardware page for Bluetooth/system or USB receipt printers.</p>
          </div>
          <ToggleRow
            label="Require Table Number"
            description="Enforce table selection on the Register page"
            checked={toggles.require_table_number}
            onChange={(v) => edit({ require_table_number: v })}
          />

          {/* POS Tile Colour Theme */}
          <div className="py-4">
            <p className="text-sm font-semibold text-gray-900 mb-0.5">Product Tile Colour Theme</p>
            <p className="text-xs text-gray-400 mb-3">Choose the colour scheme for product tiles on the Advanced POS register.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { key: 'rainbow',    label: 'Rainbow',    swatches: ['bg-green-200','bg-blue-200','bg-purple-200','bg-orange-200','bg-pink-200'] },
                { key: 'blue',       label: 'Ocean Blue', swatches: ['bg-blue-100','bg-blue-200','bg-blue-300','bg-sky-100','bg-cyan-100'] },
                { key: 'green',      label: 'Forest',     swatches: ['bg-green-100','bg-emerald-100','bg-teal-100','bg-green-200','bg-emerald-200'] },
                { key: 'warm',       label: 'Warm Tones', swatches: ['bg-orange-100','bg-amber-100','bg-yellow-100','bg-red-100','bg-pink-100'] },
                { key: 'monochrome', label: 'Monochrome', swatches: ['bg-gray-50','bg-gray-100','bg-gray-200','bg-gray-50','bg-white'] },
                { key: 'dark',       label: 'Dark',       swatches: ['bg-gray-800','bg-gray-700','bg-slate-800','bg-zinc-800','bg-neutral-800'] },
              ].map(({ key, label, swatches }) => {
                const active = (values.pos_tile_theme ?? 'rainbow') === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => edit({ pos_tile_theme: key })}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all text-left touch-manipulation ${
                      active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex gap-0.5 flex-shrink-0">
                      {swatches.slice(0, 4).map((s, i) => (
                        <span key={i} className={`w-4 h-4 rounded-sm ${s} border border-black/5`} />
                      ))}
                    </div>
                    <span className={`text-sm font-medium ${active ? 'text-blue-700' : 'text-gray-700'}`}>{label}</span>
                    {active && <span className="ml-auto w-4 h-4 rounded-full bg-blue-500 flex-shrink-0 flex items-center justify-center"><svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="white"><path d="M2 5l2 2 4-4"/></svg></span>}
                  </button>
                );
              })}
            </div>
          </div>
        </Section>
      )}

      {tab === 'inventory' && (
        <Section icon={Package} title="Inventory Settings" bodyClassName="p-6 space-y-4">
          <ToggleRow
            label="Low Stock Alerts"
            description="Show alerts when items fall below reorder point"
            checked={toggles.low_stock_alerts}
            onChange={(v) => edit({ low_stock_alerts: v })}
          />
          <ToggleRow
            label="Block Sales of Out-of-Stock Items"
            description="Prevent selling products when stock is zero or negative. Disable to allow selling regardless of stock level."
            checked={toggles.block_negative_stock}
            onChange={(v) => edit({ block_negative_stock: v })}
          />
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Default Low Stock Threshold</label>
            <input
              type="number"
              value={values.low_stock_threshold ?? ''}
              onChange={set('low_stock_threshold')}
              placeholder="5"
              className="w-full max-w-xs border border-gray-200 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            />
          </div>
        </Section>
      )}

      {tab === 'receipts' && (
        <ReceiptOptionsCard
          values={values}
          show={receiptShow}
          onShowChange={(setting, on) => edit({ [setting]: on })}
          onFooterChange={(footer) => edit({ receipt_footer: footer })}
          userName={user?.name}
          taxEnabled={toggles.tax_enabled}
        />
      )}

      {/* Barcodes — embedded weight/price barcodes, the convention a scale
          uses to print a barcode whose digits encode a PLU code plus a
          weight or price, instead of the barcode being a literal SKU. */}
      {tab === 'barcodes' && (
        <Section icon={Barcode} title="Barcodes" bodyClassName="p-6 space-y-6">
          <p className="text-xs text-gray-400 -mt-2">
            For a scale that prints barcodes with a weight or price embedded in the digits, instead of a literal product barcode. Give each sold-by-weight product a PLU Code (on its product page) matching what the scale encodes.
            Random Weight Barcodes are on from the start, set for the counter scale's labels: flag 20, and the item's 3-digit PLU Code from digit 4 (label 2001085010869 is item 108). A product's own barcode still wins if it also starts with the flag.
            A field left blank uses the grey value shown in it. Scanning a label (or typing a PLU Code) into any product search finds its product too.
          </p>

          <ScaleLabelPreset onApply={applyScaleLayout} />

          {/* Random Weight */}
          <div>
            <ToggleRow
              label="Random Weight Barcodes"
              description="A barcode starting with the prefix below encodes a PLU code and a weight"
              checked={toggles.barcode_weight_enabled}
              onChange={(v) => edit({ barcode_weight_enabled: v })}
            />
            {toggles.barcode_weight_enabled && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
                <DigitField label="Barcode Prefix" value={values.barcode_weight_prefix} onChange={set('barcode_weight_prefix')} placeholder="20" />
                <DigitField label="PLU Code Position" value={values.barcode_weight_code_position} onChange={set('barcode_weight_code_position')} placeholder="4" />
                <DigitField label="PLU Code Length" value={values.barcode_weight_code_length} onChange={set('barcode_weight_code_length')} placeholder="3" />
                <DigitField label="Weight Position" value={values.barcode_weight_qty_position} onChange={set('barcode_weight_qty_position')} placeholder="8" />
                <DigitField label="Weight Length" value={values.barcode_weight_qty_length} onChange={set('barcode_weight_qty_length')} placeholder="5" />
                <DigitField label="Decimal Point" value={values.barcode_weight_decimal_point} onChange={set('barcode_weight_decimal_point')} placeholder="3" />
                <div className="col-span-2 sm:col-span-4">
                  <label className="block text-xs text-gray-500 mb-1">Label Total Rounding</label>
                  <select
                    value={values.barcode_weight_rounding || 'none'}
                    onChange={set('barcode_weight_rounding')}
                    className="w-full sm:w-1/2 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {LABEL_ROUNDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    How the scale rounds the total it prints, so the till charges the same. A label that prints 2.15 for 0.362 kg at 6.00/kg (2.172) rounds to 0.05 — if the till rings such labels up a few cents off, pick the rounding here. Nearest and Down only differ on a label where kg × price ends in 3, 4, 8 or 9 cents: 2.18 prints 2.20 when it's Nearest, 2.15 when it's Down.
                    Price labels (below) need none: the till charges exactly what they print.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Random Price */}
          <div>
            <ToggleRow
              label="Random Price Barcodes"
              description="A barcode starting with the prefix below encodes a PLU code and a price"
              checked={toggles.barcode_price_enabled}
              onChange={(v) => edit({ barcode_price_enabled: v })}
            />
            {toggles.barcode_price_enabled && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
                <DigitField label="Barcode Prefix" value={values.barcode_price_prefix} onChange={set('barcode_price_prefix')} placeholder="2" />
                <DigitField label="PLU Code Position" value={values.barcode_price_code_position} onChange={set('barcode_price_code_position')} placeholder="4" />
                <DigitField label="PLU Code Length" value={values.barcode_price_code_length} onChange={set('barcode_price_code_length')} placeholder="4" />
                <DigitField label="Price Position" value={values.barcode_price_value_position} onChange={set('barcode_price_value_position')} placeholder="9" />
                <DigitField label="Price Length" value={values.barcode_price_value_length} onChange={set('barcode_price_value_length')} placeholder="4" />
                <DigitField label="Decimal Point" value={values.barcode_price_decimal_point} onChange={set('barcode_price_decimal_point')} placeholder="2" />
              </div>
            )}
            {priceLabelsReadAsWeight({ ...values, ...toggles }) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                Labels starting {values.barcode_weight_prefix || '20'} are read as weights first (Random Weight Barcodes, above), so none is read as a price.
                Give the scale's price labels their own flag, or switch Random Weight Barcodes off.
              </p>
            )}
          </div>

          <ScaleLabelTest settings={{ ...values, ...toggles }} onApply={applyScaleLayout} onReadAs={readLabelsAs} />
        </Section>
      )}
    </div>
  );
}
