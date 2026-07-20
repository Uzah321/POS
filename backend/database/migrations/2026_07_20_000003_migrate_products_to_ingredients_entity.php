<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Reworks "ingredients" from a flag-on-products (`products.is_ingredient`)
 * into a genuinely separate entity (the new `ingredients` table created in
 * the previous migration). Every product that was either flagged as an
 * ingredient, or already referenced as one in a recipe (`product_ingredients
 * .ingredient_product_id`), is copied into `ingredients`; recipes are
 * repointed at the new rows; the old flag/column are then removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_ingredients', function (Blueprint $table) {
            $table->foreignId('ingredient_id')->nullable()->after('ingredient_product_id')->constrained('ingredients')->cascadeOnDelete();
        });

        $productIds = DB::table('products')
            ->where('is_ingredient', true)
            ->orWhereIn('id', DB::table('product_ingredients')->select('ingredient_product_id'))
            ->get(['id', 'branch_id', 'name', 'sku', 'barcode', 'unit_id', 'cost_price', 'is_active', 'reorder_level', 'reorder_quantity']);

        $productIdToIngredientId = [];

        foreach ($productIds as $product) {
            $ingredientId = DB::table('ingredients')->insertGetId([
                'name'       => $product->name,
                'sku'        => $product->sku,
                'barcode'    => $product->barcode,
                'unit_id'    => $product->unit_id,
                'cost_price' => $product->cost_price,
                'is_active'  => $product->is_active,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $productIdToIngredientId[$product->id] = $ingredientId;

            // Carry over this product's per-warehouse stock levels.
            $stocks = DB::table('stocks')->where('product_id', $product->id)->whereNull('product_variant_id')->get(['warehouse_id', 'quantity']);
            foreach ($stocks as $stock) {
                DB::table('ingredient_stocks')->insert([
                    'ingredient_id' => $ingredientId,
                    'warehouse_id'  => $stock->warehouse_id,
                    'quantity'      => $stock->quantity,
                    'created_at'    => now(),
                    'updated_at'    => now(),
                ]);
            }

            // Carry over its reorder settings as this ingredient's Ordering-tab
            // defaults for the branch it used to belong to.
            if ($product->branch_id) {
                DB::table('ingredient_branch_settings')->insert([
                    'ingredient_id'         => $ingredientId,
                    'branch_id'             => $product->branch_id,
                    'recommended_quantity'  => $product->reorder_quantity,
                    'minimum_quantity'      => $product->reorder_level,
                    'created_at'            => now(),
                    'updated_at'            => now(),
                ]);
            }
        }

        foreach ($productIdToIngredientId as $productId => $ingredientId) {
            DB::table('product_ingredients')
                ->where('ingredient_product_id', $productId)
                ->update(['ingredient_id' => $ingredientId]);
        }

        Schema::table('product_ingredients', function (Blueprint $table) {
            $table->dropUnique('product_ingredients_product_id_ingredient_product_id_unique');
            $table->dropForeign(['ingredient_product_id']);
            $table->dropColumn('ingredient_product_id');
            $table->unique(['product_id', 'ingredient_id']);
        });
        // No doctrine/dbal in this project, so Blueprint::change() isn't
        // available to flip nullable — every row is already populated above,
        // so enforce NOT NULL directly (Postgres-only project, per .env).
        DB::statement('ALTER TABLE product_ingredients ALTER COLUMN ingredient_id SET NOT NULL');

        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('is_ingredient');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->boolean('is_ingredient')->default(false)->after('track_stock');
        });

        Schema::table('product_ingredients', function (Blueprint $table) {
            $table->dropUnique(['product_id', 'ingredient_id']);
            $table->foreignId('ingredient_product_id')->nullable()->constrained('products')->cascadeOnDelete();
        });

        // Best-effort reverse mapping — recipes are repointed back at whichever
        // product this ingredient was originally copied from, where that's
        // still resolvable by name (exact reversal isn't tracked).
        DB::table('product_ingredients')->orderBy('id')->get()->each(function ($row) {
            $ingredient = DB::table('ingredients')->find($row->ingredient_id);
            if (! $ingredient) {
                return;
            }
            $product = DB::table('products')->where('name', $ingredient->name)->first();
            if ($product) {
                DB::table('product_ingredients')->where('id', $row->id)->update(['ingredient_product_id' => $product->id]);
            }
        });

        Schema::table('product_ingredients', function (Blueprint $table) {
            $table->dropColumn('ingredient_id');
        });
    }
};
