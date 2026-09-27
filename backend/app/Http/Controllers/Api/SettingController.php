<?php namespace App\Http\Controllers\Api;
use App\Models\Setting;
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
        'company_vat_number', 'company_tin_number',
        'currency', 'currency_symbol', 'default_currency', 'multi_currency_enabled',
        'tax_enabled', 'tax_rate', 'block_negative_stock', 'low_stock_threshold',
        'loyalty_points_rate', 'receipt_footer', 'receipt_auto_print',
        'require_table_number', 'pos_tile_theme',
        'fiscal_day', 'fiscal_device_id', 'fiscal_rec_gn', 'fiscal_rec_68',
        'kds', 'queue',
    ];

    /** Scale-barcode layouts (barcode_weight_*, barcode_price_*) the till decodes with. */
    private const PUBLIC_PREFIXES = ['barcode_weight_', 'barcode_price_'];

    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $settings = Setting::all()->keyBy('key')->map(fn($s) => $s->value);
        if (! $request->user()?->can('manage_settings')) {
            $settings = $settings->filter(fn($v, $key) => in_array($key, self::PUBLIC_KEYS, true)
                || \Illuminate\Support\Str::startsWith($key, self::PUBLIC_PREFIXES));
        }
        return $this->success($settings);
    }

    public function update(Request $request): \Illuminate\Http\JsonResponse
    {
        foreach ($request->all() as $key => $value) {
            Setting::set($key, $value);
        }
        return $this->success(null,'Settings saved');
    }
}
