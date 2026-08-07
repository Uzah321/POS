<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * sku/barcode were made unique per-branch back when a branch owned a
     * single shared catalog (see 2026_07_14_000002). Now that a branch's
     * catalog is itself split into restaurant/supermarket sides that don't
     * share products, the same SKU/barcode legitimately needs to exist once
     * per side — e.g. numbering restaurant items 1001+ and supermarket items
     * 1001+ independently. Widen the constraint to (branch_id, business_type,
     * sku/barcode) so one side no longer blocks the other.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_branch_sku_unique');
            $table->dropUnique('products_branch_barcode_unique');
            $table->unique(['branch_id', 'business_type', 'sku'], 'products_branch_type_sku_unique');
            $table->unique(['branch_id', 'business_type', 'barcode'], 'products_branch_type_barcode_unique');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_branch_type_sku_unique');
            $table->dropUnique('products_branch_type_barcode_unique');
            $table->unique(['branch_id', 'sku'], 'products_branch_sku_unique');
            $table->unique(['branch_id', 'barcode'], 'products_branch_barcode_unique');
        });
    }
};
