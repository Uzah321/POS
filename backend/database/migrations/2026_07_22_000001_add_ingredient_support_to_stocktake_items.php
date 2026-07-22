<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('stocktake_items', function (Blueprint $table) {
            // A stocktake line now counts either a product's stock row or an
            // ingredient's — product_id must give way to being optional so an
            // ingredient-only line doesn't violate the not-null constraint.
            $table->foreignId('product_id')->nullable()->change();
            $table->foreignId('ingredient_id')->nullable()->after('product_variant_id')->constrained('ingredients')->cascadeOnDelete();
            $table->foreignId('ingredient_stock_id')->nullable()->after('stock_id')->constrained('ingredient_stocks')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('stocktake_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('ingredient_stock_id');
            $table->dropConstrainedForeignId('ingredient_id');
            $table->foreignId('product_id')->nullable(false)->change();
        });
    }
};
