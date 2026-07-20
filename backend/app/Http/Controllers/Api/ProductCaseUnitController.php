<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\ProductCaseUnit;
use Illuminate\Http\Request;

class ProductCaseUnitController extends BaseApiController
{
    public function show(Product $product): \Illuminate\Http\JsonResponse
    {
        $caseUnit = ProductCaseUnit::where('case_product_id', $product->id)->with('unitProduct:id,name,sku,unit_id')->first();
        return $this->success($caseUnit);
    }

    public function set(Request $request, Product $product): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'unit_product_id' => 'required|exists:products,id',
            'units_per_case'  => 'required|numeric|min:0.001',
        ]);

        if ((int) $data['unit_product_id'] === $product->id) {
            return $this->error('A case cannot contain itself', 422);
        }

        $caseUnit = ProductCaseUnit::updateOrCreate(
            ['case_product_id' => $product->id],
            ['unit_product_id' => $data['unit_product_id'], 'units_per_case' => $data['units_per_case']]
        );

        return $this->success($caseUnit->load('unitProduct:id,name,sku,unit_id'), 'Case definition saved');
    }
}
