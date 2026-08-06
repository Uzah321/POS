<?php

namespace App\Http\Controllers\Api;

use App\Models\GoodsReceiptItem;
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

    /**
     * Products marked "bulk" at goods-receipt time that still have on-hand stock —
     * i.e. sealed cases sitting in the warehouse waiting to be broken into
     * individual units via the Break Bulk / Cases panel. A product drops off this
     * list on its own once its stock is fully broken down (or sold as whole cases),
     * no separate "pending" flag to maintain — it's just current stock on a
     * product that was ever received as bulk.
     */
    public function pendingBreaks(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);
        $businessType = $this->effectiveBusinessType($request);

        $productIds = GoodsReceiptItem::where('is_bulk', true)
            ->whereHas('product', fn($q) => $q
                ->when($branchId, fn($qq) => $qq->where('branch_id', $branchId))
                ->when($businessType, fn($qq) => $this->scopeProductsToBusinessType($qq, $businessType)))
            ->distinct()
            ->pluck('product_id');

        if ($productIds->isEmpty()) {
            return $this->success([]);
        }

        $pending = Product::whereIn('id', $productIds)
            ->withSum('stocks', 'quantity')
            ->with('caseUnit.unitProduct:id,name,sku,unit_id')
            ->get()
            ->filter(fn(Product $p) => $p->total_stock > 0)
            ->map(fn(Product $p) => [
                'id'         => $p->id,
                'name'       => $p->name,
                'sku'        => $p->sku,
                'cost_price' => $p->cost_price,
                'on_hand'    => $p->total_stock,
                'case_unit'  => $p->caseUnit,
            ])
            ->sortByDesc('on_hand')
            ->values();

        return $this->success($pending);
    }

    /**
     * Clears every "bulk" flag ever recorded against this product's goods
     * receipts, so it stops showing up in pendingBreaks() — for a line that
     * was marked Bulk by mistake at receiving (it's really just a normal
     * sellable item, not a case that unpacks into something smaller).
     * Doesn't touch stock or the receipt records themselves, only the flag
     * that puts a product on the pending-breaks radar.
     */
    public function dismiss(Product $product): \Illuminate\Http\JsonResponse
    {
        GoodsReceiptItem::where('product_id', $product->id)->where('is_bulk', true)->update(['is_bulk' => false]);
        return $this->success(null, 'Removed from pending bulk breaks');
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
