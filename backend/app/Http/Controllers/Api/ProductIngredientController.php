<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\ProductIngredient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductIngredientController extends BaseApiController
{
    public function index(Product $product): \Illuminate\Http\JsonResponse
    {
        $ingredients = $product->ingredients()
            ->with('ingredient:id,name,sku,cost_price,unit_id')
            ->get();

        return response()->json([
            'data' => $ingredients,
            'cost_price' => $product->cost_price,
            'selling_price' => $product->selling_price,
            'profit' => $product->profit,
            'profit_margin' => $product->profit_margin,
        ]);
    }

    /**
     * Replace the full ingredient list for a product and recalculate its cost price.
     */
    public function sync(Request $request, Product $product): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'ingredients' => 'present|array',
            'ingredients.*.ingredient_product_id' => 'required|exists:products,id',
            'ingredients.*.quantity' => 'required|numeric|min:0.001',
        ]);

        foreach ($data['ingredients'] as $row) {
            if ((int) $row['ingredient_product_id'] === $product->id) {
                return response()->json(['message' => 'A product cannot be its own ingredient'], 422);
            }
        }

        DB::transaction(function () use ($product, $data) {
            $product->ingredients()->delete();
            foreach ($data['ingredients'] as $row) {
                ProductIngredient::create([
                    'product_id' => $product->id,
                    'ingredient_product_id' => $row['ingredient_product_id'],
                    'quantity' => $row['quantity'],
                ]);
            }
            $product->recalculateCostFromIngredients();
        });

        $product->refresh();
        $ingredients = $product->ingredients()->with('ingredient:id,name,sku,cost_price,unit_id')->get();

        return response()->json([
            'data' => $ingredients,
            'cost_price' => $product->cost_price,
            'selling_price' => $product->selling_price,
            'profit' => $product->profit,
            'profit_margin' => $product->profit_margin,
        ]);
    }
}
