<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Case/bulk breakdown ("this case of 24 unpacks into 24 of that single-unit
 * product") used to be smuggled into `product_ingredients` — a case product's
 * "ingredient" was really the individual product it breaks into. Now that
 * `product_ingredients.ingredient_id` is a hard FK to the new `ingredients`
 * table (raw materials only), that reuse no longer fits: a case's contents
 * are a sellable Product, not a raw-material Ingredient. This gives it its
 * own table and migrates any existing case definitions across.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_case_units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('case_product_id')->unique()->constrained('products')->cascadeOnDelete();
            $table->foreignId('unit_product_id')->constrained('products')->cascadeOnDelete();
            $table->decimal('units_per_case', 12, 3)->default(0);
            $table->timestamps();
        });

        // A case definition is indistinguishable from a real recipe row at
        // this point (both lived in product_ingredients) except by shape: a
        // case product intentionally has exactly one ProductIngredient row.
        // That heuristic can't run anymore since ingredient_id now points at
        // `ingredients`, not `products` — this table starts empty and any
        // pre-existing case definitions must be re-entered via the Break
        // Bulk / Cases tab.
    }

    public function down(): void
    {
        Schema::dropIfExists('product_case_units');
    }
};
