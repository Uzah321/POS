<?php namespace App\Http\Controllers\Api;
use App\Models\Setting;
use App\Services\Fiscal\ZimraVatRates;
use Illuminate\Http\Request;

class SettingController extends BaseApiController
{
    /**
     * Store settings every signed-in user needs — business type (restaurant vs
     * supermarket), receipt header, tax and fiscal receipt fields. Without
     * these, a cashier/manager's dashboard thinks no business type is set and
     * asks them to pick one they aren't allowed to save. Anything else (license
     * keys, integration credentials, ...) stays visible to manage_settings only.
     */
    private const PUBLIC_KEYS = [
        'business_type',
        'company_name', 'company_address', 'company_phone', 'company_email',
        'company_vat_number', 'company_tin_number', 'company_logo',
        'currency', 'currency_symbol', 'default_currency', 'multi_currency_enabled',
        'tax_enabled', 'tax_rate', 'block_negative_stock', 'low_stock_threshold',
        'loyalty_points_rate', 'receipt_footer', 'receipt_auto_print', 'receipt_fiscal_title',
        'require_table_number', 'pos_tile_theme',
        'fiscal_day', 'fiscal_device_id', 'fiscal_rec_gn', 'fiscal_rec_68',
        'kds', 'queue',
        // Set by system:factory-reset; tells each till to drop its local copy of the old sales.
        'data_reset_at',
    ];

    /**
     * Scale-barcode layouts (barcode_weight_*, barcode_price_*) the till decodes
     * with, and what a receipt shows (receipt_show_*, Settings > Receipts &
     * Invoices) — a cashier's till and the Android app print it.
     */
    private const PUBLIC_PREFIXES = ['barcode_weight_', 'barcode_price_', 'receipt_show_'];

    /** Never sent to a browser, not even an admin's, nor saved from here — see GoFiscalController. */
    private const SERVER_ONLY_KEYS = [\App\Services\GoFiscal\GoFiscalClient::KEY_SETTING];

    /**
     * Written only by their own flows (factory reset, the licence check).
     * Settings pages before Nov 2026 sent back every key they had loaded, so
     * these would go back to whatever that page had read.
     */
    private const SYSTEM_KEYS = ['data_reset_at', 'license_key', 'license_state'];

    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $settings = Setting::all()->keyBy('key')->map(fn($s) => $s->value)->except(self::SERVER_ONLY_KEYS);
        if (! $request->user()?->can('manage_settings')) {
            $settings = $settings->filter(fn($v, $key) => in_array($key, self::PUBLIC_KEYS, true)
                || \Illuminate\Support\Str::startsWith($key, self::PUBLIC_PREFIXES));
        }
        return $this->success($settings);
    }

    /**
     * Saves only the settings sent, leaving every other one as it is. The
     * Settings page sends just what was changed on it. Returns what was saved,
     * as stored.
     */
    public function update(Request $request, ZimraVatRates $zimra): \Illuminate\Http\JsonResponse
    {
        $changes = $request->except([...self::SERVER_ONLY_KEYS, ...self::SYSTEM_KEYS]);

        if (array_key_exists('tax_enabled', $changes)) {
            $changes['tax_enabled'] = filter_var($changes['tax_enabled'], FILTER_VALIDATE_BOOLEAN) ? 'true' : 'false';
        }
        if (array_key_exists('tax_rate', $changes)) {
            $rate = str_replace(',', '.', trim((string) $changes['tax_rate']));
            if ($rate !== '' && (! is_numeric($rate) || (float) $rate < 0 || (float) $rate > 100)) {
                return $this->error('Tax Rate must be a percentage from 0 to 100, like 15.5.', 422, ['tax_rate' => ['Tax Rate must be a percentage from 0 to 100, like 15.5.']]);
            }
            $changes['tax_rate'] = $rate === '' ? '' : ZimraVatRates::format((float) $rate);
        }

        if (array_key_exists('tax_enabled', $changes) || array_key_exists('tax_rate', $changes)) {
            $mismatch = $this->zimraMismatch($changes, $zimra);
            if ($mismatch) {
                return $this->error($mismatch, 422, ['tax_rate' => [$mismatch]]);
            }
        }

        foreach ($changes as $key => $value) {
            Setting::set($key, $value);
        }
        return $this->success((object) $changes, 'Settings saved');
    }

    /** ZIMRA's standard VAT rate for this store's fiscal devices, for Settings to show beside Tax Rate. */
    public function zimraVat(ZimraVatRates $zimra): \Illuminate\Http\JsonResponse
    {
        return $this->success(['rates' => $zimra->standardRates()]);
    }

    /**
     * Why tax can't be saved like this, if it can't. With tax on, a sale's VAT
     * is worked out at Tax Rate, and its fiscal receipt goes to ZIMRA at the
     * device's standard rate (with no rate, at 0%). The two must be the same.
     */
    private function zimraMismatch(array $changes, ZimraVatRates $zimra): ?string
    {
        $enabled = filter_var($changes['tax_enabled'] ?? Setting::get('tax_enabled', false), FILTER_VALIDATE_BOOLEAN);
        if (! $enabled) {
            return null;
        }
        $rates = $zimra->standardRates();
        $rate = (float) ($changes['tax_rate'] ?? Setting::get('tax_rate', 0));
        if (! $rates || ZimraVatRates::matches($rate, $rates)) {
            return null;
        }

        $zimraText = implode(' or ', array_map(fn ($r) => ZimraVatRates::format($r).'%', $rates));
        $ours = $rate > 0 ? 'at '.ZimraVatRates::format($rate).'%' : 'with no Tax Rate';

        return "Your fiscal device records VAT with ZIMRA at {$zimraText}. Set Tax Rate to "
            .ZimraVatRates::format($rates[0])." — {$ours}, receipts would show different VAT from what ZIMRA records.";
    }
}
