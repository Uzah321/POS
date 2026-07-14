<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->foreignId('branch_id')->nullable()->after('id')->constrained('branches')->nullOnDelete();
        });

        // Every product created before this migration belonged to the single
        // shared catalog — attach them all to the first branch so nothing
        // that already exists silently disappears from every branch's view.
        $firstBranchId = DB::table('branches')->orderBy('id')->value('id');
        if ($firstBranchId) {
            DB::table('products')->whereNull('branch_id')->update(['branch_id' => $firstBranchId]);
        }

        // sku/barcode used to be globally unique (one shared catalog). Now that
        // each branch owns its own catalog, the same real-world item (same SKU
        // or barcode) legitimately needs its own row per branch — e.g. via the
        // stock-transfer auto-clone. Uniqueness now applies per branch instead.
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_sku_unique');
            $table->dropUnique('products_barcode_unique');
            $table->unique(['branch_id', 'sku'], 'products_branch_sku_unique');
            $table->unique(['branch_id', 'barcode'], 'products_branch_barcode_unique');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_branch_sku_unique');
            $table->dropUnique('products_branch_barcode_unique');
            $table->unique('sku');
            $table->unique('barcode');
        });

        Schema::table('products', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
    }
};
