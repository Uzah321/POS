import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../api';
import { Loader2, Save, Building2, ShoppingCart, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { offlineMutate } from '../lib/offlineMutation';

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

          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Fiscal Device Details</p>
            <p className="text-xs text-gray-400 mt-0.5 mb-3">
              Optional — only fill these in if you already have a certified fiscal device issuing these numbers elsewhere.
              This software does not itself fiscalize receipts with ZIMRA, so these are printed as-is, exactly as entered.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Device ID</label>
                <input value={values.fiscal_device_id ?? ''} onChange={set('fiscal_device_id')} placeholder="22449" className={field} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Fiscal Day</label>
                <input value={values.fiscal_day ?? ''} onChange={set('fiscal_day')} placeholder="440" className={field} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">REC GN</label>
                <input value={values.fiscal_rec_gn ?? ''} onChange={set('fiscal_rec_gn')} placeholder="47979" className={field} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">REC 68</label>
                <input value={values.fiscal_rec_68 ?? ''} onChange={set('fiscal_rec_68')} placeholder="1" className={field} />
              </div>
            </div>
          </div>
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

    </div>
  );
}
