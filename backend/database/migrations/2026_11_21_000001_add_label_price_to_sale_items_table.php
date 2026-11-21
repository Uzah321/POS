<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A scale label rounded to 0.05 (Settings → Barcodes) is charged at its
 * printed total: 0.526 kg at 3.49/kg prints 1.85, so the line's unit_price
 * is 1.85 / 0.526 = 3.5171 to keep quantity × unit_price = total (and the
 * ZIMRA line price consistent). label_price keeps the 3.49 the label shows,
 * for receipts and sales history to show instead. Null for every other line.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->decimal('label_price', 18, 6)->nullable()->after('unit_price');
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->dropColumn('label_price');
        });
    }
};
