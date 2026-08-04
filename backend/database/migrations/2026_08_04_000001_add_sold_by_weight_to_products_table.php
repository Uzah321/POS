<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Butchery/deli/produce items priced per kg — the till reads a live
            // weight off a connected scale instead of counting units, and the
            // cart quantity becomes a fractional kg amount (sale_items.quantity
            // is already decimal(15,3), so no schema change needed there).
            $table->boolean('sold_by_weight')->default(false)->after('unit_id');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('sold_by_weight');
        });
    }
};
