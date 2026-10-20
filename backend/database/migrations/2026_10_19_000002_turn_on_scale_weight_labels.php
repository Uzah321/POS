<?php

use App\Models\Setting;
use Illuminate\Database\Migrations\Migration;

/**
 * Scale weight labels (flag 20, the item's 3-digit PLU code from digit 4)
 * are now on until switched off. Saving Settings stores every toggle, so
 * most installs hold an explicit "false" for them that nobody chose — turn
 * it on once. Left alone where price labels are on with a flag that
 * overlaps the weight one: weight is decoded first and would swallow them.
 */
return new class extends Migration
{
    public function up(): void
    {
        $settings = Setting::whereIn('key', [
            'barcode_weight_prefix', 'barcode_price_enabled', 'barcode_price_prefix',
        ])->pluck('value', 'key');

        $weightFlag = trim((string) ($settings['barcode_weight_prefix'] ?? '')) ?: '20';
        $priceFlag = trim((string) ($settings['barcode_price_prefix'] ?? '')) ?: '2';
        $priceOn = filter_var($settings['barcode_price_enabled'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $overlap = str_starts_with($weightFlag, $priceFlag) || str_starts_with($priceFlag, $weightFlag);

        if ($priceOn && $overlap) {
            // ...and kept off: with nothing saved, they'd now default to on.
            if (! Setting::where('key', 'barcode_weight_enabled')->exists()) {
                Setting::set('barcode_weight_enabled', 'false');
            }
            return;
        }
        Setting::set('barcode_weight_enabled', 'true');
    }

    public function down(): void
    {
        // Which installs had it off before can't be told apart afterwards.
    }
};
