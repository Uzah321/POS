<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Whether tax applies to this product at all. Defaults true so existing
            // products keep their current behavior (taxed at their own tax_rate_id,
            // or the store-wide rate when unset) — this only matters for the
            // products someone explicitly marks exempt.
            $table->boolean('is_taxable')->default(true)->after('tax_rate_id');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('is_taxable');
        });
    }
};
