import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, productsApi } from '../api';
import { Loader2, Save, Building2, ShoppingCart, Package, Landmark, Barcode, Scale } from 'lucide-react';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';
import FiscalisationPanel from '../components/FiscalisationPanel';
import { useAuthStore } from '../stores/authStore';
import { useCurrencyStore } from '../stores/currencyStore';
import {
  DIGI_SM110_LAYOUTS, embeddedCartLine, normalizePlu, readScaleLabel, resolveEmbeddedBarcode, scaleLayoutSettings, singleReading,
  type ScaleBarcodeLayout,
} from '../lib/barcode/embeddedBarcode';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

const field = 'w-full border border-gray-200 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';

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

function ScaleLabelTest({ settings, onApply }: { settings: Record<string, unknown>; onApply: ApplyLayout }) {
  const user = useAuthStore((s) => s.user);
  const { format: formatCurrency } = useCurrencyStore();
  const [code, setCode] = useState('');
  const trimmed = code.trim();

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ['plu-check-products', user?.branch?.id],
    queryFn: () => productsApi.list({ per_page: 500, is_active: 1, branch_id: user?.branch?.id })
      .then((r) => r.data?.data?.data ?? r.data?.data ?? []),
    enabled: trimmed !== '',
  });
  const label = trimmed && !isLoading ? resolveEmbeddedBarcode(trimmed, settings, products) : null;
  const decoded = label?.decoded;
  const product = label?.product;
  const line = decoded && product ? embeddedCartLine(decoded, parseFloat(product.selling_price)) : null;
  // What the label says by itself, for when the fields above don't get to a product.
  const reading = trimmed && !isLoading && !product ? singleReading(readScaleLabel(trimmed, products)) : null;
  const layoutName = (l: ScaleBarcodeLayout) => <>layout {l.spec} (<span className="font-mono">{l.pattern}</span>)</>;
  const applyButton = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md';

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

export default function SettingsPage() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [toggles, setToggles] = useState({
    tax_enabled: false,
    loyalty_enabled: false,
    multi_currency_enabled: true,
    receipt_auto_print: false,
    low_stock_alerts: true,
    require_table_number: false,
    block_negative_stock: true,
    barcode_weight_enabled: false,
    barcode_price_enabled: false,
  });
const { isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get().then(r => {
      const data = r.data?.data || {};
      setValues(data);
      setToggles(prev => ({
        ...prev,
        multi_currency_enabled: data.multi_currency_enabled === 'true' || data.multi_currency_enabled === true,
        tax_enabled: data.tax_enabled === 'true' || data.tax_enabled === true,
        loyalty_enabled: data.loyalty_enabled === 'true' || data.loyalty_enabled === true,
        receipt_auto_print: data.receipt_auto_print === 'true' || data.receipt_auto_print === true,
        low_stock_alerts: data.low_stock_alerts !== 'false' && data.low_stock_alerts !== false,
        require_table_number: data.require_table_number === 'true' || data.require_table_number === true,
        block_negative_stock: data.block_negative_stock !== 'false' && data.block_negative_stock !== false,
        barcode_weight_enabled: data.barcode_weight_enabled === 'true' || data.barcode_weight_enabled === true,
        barcode_price_enabled: data.barcode_price_enabled === 'true' || data.barcode_price_enabled === true,
      }));
      return data;
    }),
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...values,
        ...Object.fromEntries(Object.entries(toggles).map(([k, v]) => [k, v.toString()])),
      };
      return offlineMutate(() => settingsApi.update(payload), 'settings', 'update', { _url: '/settings', _method: 'POST', ...payload });
    },
    onSuccess: (result) => {
      if (result.offline) toast.success('Settings saved offline - will sync when server is back');
      else toast.success('Settings saved successfully');
      // Every page that reads settings (POS, Cashier, Dashboard, etc.) shares
      // this same cached query — without invalidating it here, a saved change
      // like the tile color theme sat invisible on those screens for up to
      // the global 5-minute staleTime, or until something else happened to
      // refetch it.
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues(v => ({ ...v, [key]: e.target.value }));

  const applyScaleLayout = (kind: 'weight' | 'price', layout: ScaleBarcodeLayout, flag: string) => {
    setValues(v => ({ ...v, ...scaleLayoutSettings(layout, flag, kind) }));
    // Two formats can't share a flag — weight is tried first when decoding,
    // so it would swallow every price label. Switch the other one off if its
    // flag overlaps.
    const otherPrefix = String(values[kind === 'weight' ? 'barcode_price_prefix' : 'barcode_weight_prefix'] ?? '');
    const clash = otherPrefix !== '' && (otherPrefix.startsWith(flag) || flag.startsWith(otherPrefix));
    setToggles(t => ({
      ...t,
      barcode_weight_enabled: kind === 'weight' || (!clash && t.barcode_weight_enabled),
      barcode_price_enabled: kind === 'price' || (!clash && t.barcode_price_enabled),
    }));
    toast.success('Filled in — scan a label to check it, then Save Changes');
  };

  if (isLoading) return (
    <div className="flex justify-center py-16">
      <Loader2 size={28} className="animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-400 text-sm mt-0.5">Configure your Core</p>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-md text-sm shadow-md shadow-blue-100 transition-colors disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save Changes
        </button>
      </div>

      {/* Business Profile */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
            <Building2 size={16} className="text-blue-600" />
          </div>
          <h2 className="font-semibold text-gray-900">Business Profile</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Business Name</label>
              <input value={values.company_name ?? ''} onChange={set('company_name')} placeholder="Core" className={field} />
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
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tax Rate (%)</label>
              <input type="number" step="0.1" value={values.tax_rate ?? ''} onChange={set('tax_rate')} placeholder="15" className={field} />
            </div>
          </div>

        </div>
      </div>

      {/* ZIMRA Fiscalisation */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
            <Landmark size={16} className="text-blue-600" />
          </div>
          <h2 className="font-semibold text-gray-900">ZIMRA Fiscalisation</h2>
        </div>
        <div className="p-6">
          <FiscalisationPanel />
        </div>
      </div>

      {/* Register Preferences */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
            <ShoppingCart size={16} className="text-blue-600" />
          </div>
          <h2 className="font-semibold text-gray-900">Register Preferences</h2>
        </div>
        <div className="px-6 py-2">
          <ToggleRow
            label="Enable Tax"
            description="Apply tax on all sales transactions"
            checked={toggles.tax_enabled}
            onChange={(v) => setToggles(t => ({ ...t, tax_enabled: v }))}
          />
          <ToggleRow
            label="Loyalty Points"
            description="Allow customers to earn and redeem points"
            checked={toggles.loyalty_enabled}
            onChange={(v) => setToggles(t => ({ ...t, loyalty_enabled: v }))}
          />
          <ToggleRow
            label="Multi-Currency"
            description="Support multiple currencies at checkout"
            checked={toggles.multi_currency_enabled}
            onChange={(v) => setToggles(t => ({ ...t, multi_currency_enabled: v }))}
          />
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Receipt Printing</p>
            <p className="text-sm text-gray-600 mt-1">Every completed order prints a receipt. Choose the receipt printer mode from the Hardware page for Bluetooth/system or USB receipt printers.</p>
          </div>
          <ToggleRow
            label="Require Table Number"
            description="Enforce table selection on the Register page"
            checked={toggles.require_table_number}
            onChange={(v) => setToggles(t => ({ ...t, require_table_number: v }))}
          />

          {/* POS Tile Colour Theme */}
          <div className="py-4 border-b border-gray-50">
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
                    onClick={() => setValues(v => ({ ...v, pos_tile_theme: key }))}
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
        </div>
      </div>

      {/* Inventory Settings */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
            <Package size={16} className="text-blue-600" />
          </div>
          <h2 className="font-semibold text-gray-900">Inventory Settings</h2>
        </div>
        <div className="p-6 space-y-4">
          <ToggleRow
            label="Low Stock Alerts"
            description="Show alerts when items fall below reorder point"
            checked={toggles.low_stock_alerts}
            onChange={(v) => setToggles(t => ({ ...t, low_stock_alerts: v }))}
          />
          <ToggleRow
            label="Block Sales of Out-of-Stock Items"
            description="Prevent selling products when stock is zero or negative. Disable to allow selling regardless of stock level."
            checked={toggles.block_negative_stock}
            onChange={(v) => setToggles(t => ({ ...t, block_negative_stock: v }))}
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
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Receipt Footer Message</label>
            <textarea
              value={values.receipt_footer ?? ''}
              onChange={set('receipt_footer')}
              rows={2}
              placeholder="Thank you for your purchase!"
              className={`${field} resize-none`}
            />
          </div>
        </div>
      </div>

      {/* Barcodes — embedded weight/price barcodes, the convention a scale
          uses to print a barcode whose digits encode a PLU code plus a
          weight or price, instead of the barcode being a literal SKU. */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
            <Barcode size={16} className="text-blue-600" />
          </div>
          <h2 className="font-semibold text-gray-900">Barcodes</h2>
        </div>
        <div className="p-6 space-y-6">
          <p className="text-xs text-gray-400 -mt-2">
            For a scale that prints barcodes with a weight or price embedded in the digits, instead of a literal product barcode. Give each sold-by-weight product a PLU Code (on its product page) matching what the scale encodes — leave both off if your scale prints plain product barcodes.
            A field left blank uses the grey value shown in it. Scanning a label (or typing a PLU Code) into any product search finds its product too.
          </p>

          <ScaleLabelPreset onApply={applyScaleLayout} />

          {/* Random Weight */}
          <div>
            <ToggleRow
              label="Random Weight Barcodes"
              description="A barcode starting with the prefix below encodes a PLU code and a weight"
              checked={toggles.barcode_weight_enabled}
              onChange={(v) => setToggles(t => ({ ...t, barcode_weight_enabled: v }))}
            />
            {toggles.barcode_weight_enabled && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
                <DigitField label="Barcode Prefix" value={values.barcode_weight_prefix} onChange={set('barcode_weight_prefix')} placeholder="20" />
                <DigitField label="PLU Code Position" value={values.barcode_weight_code_position} onChange={set('barcode_weight_code_position')} placeholder="4" />
                <DigitField label="PLU Code Length" value={values.barcode_weight_code_length} onChange={set('barcode_weight_code_length')} placeholder="3" />
                <DigitField label="Weight Position" value={values.barcode_weight_qty_position} onChange={set('barcode_weight_qty_position')} placeholder="8" />
                <DigitField label="Weight Length" value={values.barcode_weight_qty_length} onChange={set('barcode_weight_qty_length')} placeholder="5" />
                <DigitField label="Decimal Point" value={values.barcode_weight_decimal_point} onChange={set('barcode_weight_decimal_point')} placeholder="3" />
              </div>
            )}
          </div>

          {/* Random Price */}
          <div>
            <ToggleRow
              label="Random Price Barcodes"
              description="A barcode starting with the prefix below encodes a PLU code and a price"
              checked={toggles.barcode_price_enabled}
              onChange={(v) => setToggles(t => ({ ...t, barcode_price_enabled: v }))}
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
          </div>

          <ScaleLabelTest settings={{ ...values, ...toggles }} onApply={applyScaleLayout} />
        </div>
      </div>

    </div>
  );
}
