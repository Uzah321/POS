<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\ProductIngredient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductIngredientController extends BaseApiController
{
    /** True once a branch-locked user tries to touch another branch's product. Admins are exempt. */
    private function forbiddenCrossBranch(Request $request, Product $product): bool
    {
        $user = $request->user();
        return ! $user->hasRole('admin') && $product->branch_id !== $user->branch_id;
    }

    public function index(Request $request, Product $product): \Illuminate\Http\JsonResponse
    {
        if ($this->forbiddenCrossBranch($request, $product)) {
            return response()->json(['message' => 'Product not found.'], 404);
        }

        $ingredients = $product->ingredients()
            ->with(['ingredient:id,name,sku,cost_price,unit_id', 'ingredient.unit:id,name,abbreviation'])
            ->get();

        return response()->json([
            'data' => $ingredients,
            'description' => $product->description,
            'image' => $product->image,
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
        if ($this->forbiddenCrossBranch($request, $product)) {
            return response()->json(['message' => 'Product not found.'], 404);
        }

        $data = $request->validate([
            'ingredients' => 'present|array',
            'ingredients.*.ingredient_id' => 'required|exists:ingredients,id',
            'ingredients.*.quantity' => 'required|numeric|min:0.001',
        ]);

        DB::transaction(function () use ($product, $data) {
            $product->ingredients()->delete();
            foreach ($data['ingredients'] as $row) {
                ProductIngredient::create([
                    'product_id' => $product->id,
                    'ingredient_id' => $row['ingredient_id'],
                    'quantity' => $row['quantity'],
                ]);
            }
            $product->recalculateCostFromIngredients();
        });

        $product->refresh();
        $ingredients = $product->ingredients()->with(['ingredient:id,name,sku,cost_price,unit_id', 'ingredient.unit:id,name,abbreviation'])->get();

        return response()->json([
            'data' => $ingredients,
            'description' => $product->description,
            'image' => $product->image,
            'cost_price' => $product->cost_price,
            'selling_price' => $product->selling_price,
            'profit' => $product->profit,
            'profit_margin' => $product->profit_margin,
        ]);
    }
}
