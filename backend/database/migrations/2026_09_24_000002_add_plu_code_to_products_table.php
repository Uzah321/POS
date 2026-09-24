<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * PLU ("Price Look-Up") code — the short department/product code a
     * weighing scale embeds into a printed barcode alongside a weight or
     * price, distinct from the product's full `barcode` (which is the
     * literal string on a normal, non-embedded barcode). Nullable/unique
     * per branch+business_type like sku/barcode already are, since a scale
     * only needs this for sold_by_weight products.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('plu_code', 20)->nullable()->after('barcode');
            $table->unique(['branch_id', 'business_type', 'plu_code'], 'products_branch_type_plu_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_branch_type_plu_code_unique');
            $table->dropColumn('plu_code');
        });
    }
};
