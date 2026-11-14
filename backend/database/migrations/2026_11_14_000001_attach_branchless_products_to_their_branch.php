<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The Excel stock import created products without a branch. Each branch only
 * sees its own catalogue — the tills list, and a sale accepts, products of the
 * cashier's branch — so those products were on the Products page but could
 * not be found or sold at any till.
 *
 * Gives each branchless product the branch of the warehouse holding its
 * stock, or the shop's only branch. One whose SKU or barcode that branch
 * already uses is left alone rather than break the per-branch uniqueness.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('products', 'branch_id')) {
            return;
        }

        $branches = DB::table('branches')->pluck('id');
        if ($branches->isEmpty()) {
            return;
        }
        $onlyBranch = $branches->count() === 1 ? $branches->first() : null;

        // product id => the branches of the warehouses its stock is in.
        $stockBranches = DB::table('stocks')
            ->join('warehouses', 'warehouses.id', '=', 'stocks.warehouse_id')
            ->whereIn('stocks.product_id', DB::table('products')->whereNull('branch_id')->select('id'))
            ->whereNotNull('warehouses.branch_id')
            ->distinct()
            ->get(['stocks.product_id', 'warehouses.branch_id'])
            ->groupBy('product_id')
            ->map(fn ($rows) => $rows->pluck('branch_id')->unique()->values());

        DB::table('products')->whereNull('branch_id')
            ->select('id', 'sku', 'barcode', 'business_type')
            ->chunkById(500, function ($products) use ($stockBranches, $onlyBranch) {
                foreach ($products as $product) {
                    $fromStock = $stockBranches->get($product->id);
                    $branchId = ($fromStock && $fromStock->count() === 1) ? $fromStock->first() : $onlyBranch;
                    if (! $branchId || $this->codeTaken($product, (int) $branchId)) {
                        continue;
                    }
                    DB::table('products')->where('id', $product->id)->update(['branch_id' => $branchId]);
                }
            });
    }

    /** Whether the branch already has a product (same business type) with this one's SKU or barcode. */
    private function codeTaken(object $product, int $branchId): bool
    {
        foreach (['sku', 'barcode'] as $column) {
            if ($product->{$column} === null) {
                continue;
            }
            $taken = DB::table('products')
                ->where('branch_id', $branchId)
                ->where('business_type', $product->business_type)
                ->where($column, $product->{$column})
                ->exists();
            if ($taken) {
                return true;
            }
        }

        return false;
    }

    public function down(): void
    {
        // Data repair only — nothing to undo.
    }
};
