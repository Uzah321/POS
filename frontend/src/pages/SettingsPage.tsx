import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { settingsApi } from '../api';
import { Loader2, Save, Building2, ShoppingCart, Package } from 'lucide-react';
import toast from 'react-hot-toast';

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

const field = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors';

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [toggles, setToggles] = useState({
    tax_enabled: false,
    loyalty_enabled: false,
    multi_currency_enabled: true,
    receipt_auto_print: false,
    low_stock_alerts: true,
    require_table_number: false,
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
      }));
      return data;
    }),
  });

  const mutation = useMutation({
    mutationFn: () => settingsApi.update({
      ...values,
      ...Object.fromEntries(Object.entries(toggles).map(([k, v]) => [k, v.toString()])),
    }),
    onSuccess: () => toast.success('Settings saved successfully'),
    onError: () => toast.error('Failed to save settings'),
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
          <p className="text-gray-400 text-sm mt-0.5">Configure your DiaperMart Store</p>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl text-sm shadow-md shadow-blue-100 transition-colors disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save Changes
        </button>
      </div>

      {/* Business Profile */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
              <input value={values.company_name ?? ''} onChange={set('company_name')} placeholder="DiaperMart Store" className={field} />
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
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tax Rate (%)</label>
              <input type="number" step="0.1" value={values.tax_rate ?? ''} onChange={set('tax_rate')} placeholder="15" className={field} />
            </div>
          </div>
        </div>
      </div>

      {/* Register Preferences */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Receipt Printing</p>
            <p className="text-sm text-gray-600 mt-1">Every completed order prints a receipt. Choose the receipt printer mode from the Hardware page for Bluetooth/system or USB receipt printers.</p>
          </div>
          <ToggleRow
            label="Require Table Number"
            description="Enforce table selection on the Register page"
            checked={toggles.require_table_number}
            onChange={(v) => setToggles(t => ({ ...t, require_table_number: v }))}
          />
        </div>
      </div>

      {/* Inventory Settings */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Default Low Stock Threshold</label>
            <input
              type="number"
              value={values.low_stock_threshold ?? ''}
              onChange={set('low_stock_threshold')}
              placeholder="5"
              className="w-full max-w-xs border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
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
