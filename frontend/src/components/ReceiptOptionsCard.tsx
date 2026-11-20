import { useMemo } from 'react';
import { Receipt } from 'lucide-react';
import { buildReceiptHtml, companyDetails, type ReceiptData } from '../lib/hardware/printer';
import { RECEIPT_OPTIONS, ZIMRA_REQUIRED, type ReceiptOption, type ReceiptShow } from '../lib/receiptOptions';

const GROUPS: ReceiptOption['group'][] = ['Top of the receipt', 'Sale details', 'Totals & tax', 'Bottom of the receipt'];

/**
 * Settings > Receipts & Invoices: what every customer receipt / tax invoice
 * shows, for the whole shop, with a live preview. Held with the other
 * settings until Save Changes.
 */
export default function ReceiptOptionsCard({ values, show, onShowChange, onFooterChange, userName, taxEnabled }: {
  /** The Settings form's current values (company details, footer, fiscal fields). */
  values: Record<string, string>;
  /** On/off per settings key (RECEIPT_OPTIONS[].setting). */
  show: Record<string, boolean>;
  onShowChange: (setting: string, on: boolean) => void;
  onFooterChange: (footer: string) => void;
  userName?: string;
  /** Register Preferences › Enable Tax, as the form has it: with it off, sales carry no VAT, so neither do receipts. */
  taxEnabled: boolean;
}) {
  const vatBreakdownOn = show.receipt_show_vat_breakdown !== false;
  const preview = useMemo(() => {
    const { storeName, ...company } = companyDetails(values);
    const showFlags = Object.fromEntries(RECEIPT_OPTIONS.map((o) => [o.key, show[o.setting] !== false])) as unknown as ReceiptShow;
    // A sale as the till records one: prices include VAT, which is taken out
    // of the total (at the Tax Rate, or 15%) — none when tax is off.
    const total = 17.25;
    const vatRate = taxEnabled ? (parseFloat(values.tax_rate) > 0 ? parseFloat(values.tax_rate) : 15) : 0;
    const tax = Math.round((total - total / (1 + vatRate / 100)) * 100) / 100;
    const sample: ReceiptData = {
      ...company,
      show: showFlags,
      storeName: storeName ?? 'My Shop',
      reference: 'INV-0001',
      cashier: userName || 'Cashier',
      date: new Date().toISOString(),
      items: [
        { name: 'Sample item', qty: 2, price: 5, total: 10, sku: 'SKU-001', barcode: '6001234567890' },
        { name: 'Another item', qty: 1, price: 7.25, total: 7.25, sku: 'SKU-002' },
      ],
      subtotal: total,
      tax,
      discount: 0,
      total,
      vatRate,
      paymentMethod: 'cash',
      amountTendered: 20,
      change: 2.75,
      currency: '$',
      currencyCode: 'USD',
      currencyRate: 1,
      customerName: 'Sample Customer',
      tableNumber: 'T-4',
      covers: 2,
      orderType: 'takeaway',
      deviceId: values.fiscal_device_id || undefined,
      fiscalDay: values.fiscal_day || undefined,
      recGn: values.fiscal_rec_gn || undefined,
      rec68: values.fiscal_rec_68 || undefined,
    };
    return buildReceiptHtml(sample);
  }, [values, show, userName, taxEnabled]);

  return (
    <div id="receipts" className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden scroll-mt-4">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
          <Receipt size={16} className="text-blue-600" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Receipts &amp; Invoices</h2>
          <p className="text-xs text-gray-400">What every customer receipt shows — on every till, printer and the Android app.</p>
        </div>
      </div>
      <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6">
        <div className="space-y-5 min-w-0">
          {GROUPS.map((group) => (
            <div key={group}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{group}</p>
              <div className="divide-y divide-gray-50">
                {RECEIPT_OPTIONS.filter((o) => o.group === group).map((o) => (
                  <label key={o.setting} className="flex items-start justify-between gap-4 py-2.5 cursor-pointer">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800">
                        {o.label}
                        {ZIMRA_REQUIRED.includes(o.key) && <span className="ml-1.5 text-[10px] font-semibold text-amber-600 align-middle">ZIMRA</span>}
                      </span>
                      {o.hint && <span className="block text-xs text-gray-400 mt-0.5">{o.hint}</span>}
                      {o.key === 'tax' && vatBreakdownOn && !taxEnabled && (
                        <span className="block text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                          Tax is off (Register Preferences › Enable Tax), so sales carry no VAT and this prints VAT as 0.00.
                          Turn Enable Tax on to show the VAT inside your prices. Prices and totals stay the same.
                        </span>
                      )}
                      {o.key === 'tax' && vatBreakdownOn && taxEnabled && !(parseFloat(values.tax_rate) > 0) && (
                        <span className="block text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                          Tax Rate (%) is blank, so only products given their own tax rate carry VAT. The rest print VAT as 0.00.
                          Enter the rate (e.g. 15) under Tax Rate.
                        </span>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 flex-shrink-0 accent-blue-600"
                      checked={show[o.setting] !== false}
                      onChange={(e) => onShowChange(o.setting, e.target.checked)}
                    />
                  </label>
                ))}
              </div>
              {group === 'Bottom of the receipt' && (
                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-800 mb-1.5">Footer text</label>
                  <textarea
                    value={values.receipt_footer ?? ''}
                    onChange={(e) => onFooterChange(e.target.value)}
                    rows={2}
                    placeholder="Thank you for your purchase!"
                    className="w-full border border-gray-200 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white resize-none"
                  />
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-gray-400">
            <span className="font-semibold text-amber-600">ZIMRA</span>: a receipt fiscalised with ZIMRA always keeps these, as ZIMRA requires.
            Layout, font and paper size are set per device in Hardware › Receipt. Click <b>Save Changes</b> to apply.
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Preview</p>
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-2">
            <iframe title="Receipt preview" srcDoc={preview} className="block bg-white mx-auto" style={{ width: 330, height: 620, border: 0 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
