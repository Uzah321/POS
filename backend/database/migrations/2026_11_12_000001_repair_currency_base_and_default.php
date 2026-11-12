<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Puts the currencies into the shape the app now relies on (CurrencyController):
 * the base currency USD exists, is active and has a rate of exactly 1, and
 * exactly one active currency is the default. Before, a USD rate could be
 * edited away from 1, and the default could be unticked or switched off.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('currencies')) {
            return;
        }

        $now = now();
        $usd = DB::table('currencies')->where('code', 'USD')->first();
        if (! $usd) {
            DB::table('currencies')->insert([
                'code' => 'USD', 'name' => 'US Dollar', 'symbol' => '$', 'exchange_rate' => 1,
                'is_default' => false, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
            ]);
        } elseif ((float) $usd->exchange_rate !== 1.0) {
            DB::table('currencies')->where('code', 'USD')->update(['exchange_rate' => 1, 'updated_at' => $now]);
        }

        // One default, and it is active: keep the (first) active default, else USD.
        $default = DB::table('currencies')->where('is_default', true)->where('is_active', true)->orderBy('id')->first()
            ?? DB::table('currencies')->where('code', 'USD')->first();
        DB::table('currencies')->where('id', '!=', $default->id)->where('is_default', true)->update(['is_default' => false, 'updated_at' => $now]);
        DB::table('currencies')->where('id', $default->id)->update(['is_default' => true, 'is_active' => true, 'updated_at' => $now]);
    }

    public function down(): void
    {
        // Data repair only — nothing to undo.
    }
};
