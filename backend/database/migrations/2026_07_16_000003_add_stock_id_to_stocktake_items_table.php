<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stocktake_items', function (Blueprint $table) {
            // Ties each line to the exact stock row it was counted from, so completing
            // a stocktake updates that one row instead of every stock row sharing the
            // same product_id (which previously let one line's count overwrite another
            // warehouse/batch's stock for the same product).
            $table->foreignId('stock_id')->nullable()->after('product_variant_id')->constrained('stocks')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('stocktake_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('stock_id');
        });
    }
};
