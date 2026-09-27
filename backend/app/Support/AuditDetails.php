<?php

namespace App\Support;

use App\Models\{
    Branch, Brand, Category, Customer, GoodsReceipt, Ingredient, Layby, Product,
    PurchaseOrder, Quotation, Refund, Register, RestaurantTable, Sale, StockAdjustment,
    StockCount, Stocktake, StockTransfer, Supplier, TaxRate, Unit, User, Warehouse,
};
use Illuminate\Database\Eloquent\Model;

/**
 * Builds the human-readable detail stored alongside each audit log row, so
 * the log can say "Coke 500ml +10 at Main Warehouse" instead of
 * "StockAdjustment #5 created". Everything is resolved at write time on
 * purpose: if a product or warehouse is renamed or deleted later, the log
 * still shows what it was called when the action happened.
 */
class AuditDetails
{
    /** Foreign-key columns whose ids get resolved to a display name, and the model + column to read it from. */
    private const REFS = [
        'product_id'        => [Product::class, 'name'],
        'unit_product_id'   => [Product::class, 'name'],
        'case_product_id'   => [Product::class, 'name'],
        'ingredient_id'     => [Ingredient::class, 'name'],
        'warehouse_id'      => [Warehouse::class, 'name'],
        'from_warehouse_id' => [Warehouse::class, 'name'],
        'to_warehouse_id'   => [Warehouse::class, 'name'],
        'branch_id'         => [Branch::class, 'name'],
        'customer_id'       => [Customer::class, 'name'],
        'supplier_id'       => [Supplier::class, 'name'],
        'category_id'       => [Category::class, 'name'],
        'parent_id'         => [Category::class, 'name'],
        'brand_id'          => [Brand::class, 'name'],
        'unit_id'           => [Unit::class, 'name'],
        'tax_rate_id'       => [TaxRate::class, 'name'],
        'register_id'       => [Register::class, 'name'],
        'table_id'          => [RestaurantTable::class, 'name'],
        'scale_id'          => [\App\Models\WeighingScale::class, 'name'],
        'sale_id'           => [Sale::class, 'reference'],
        'purchase_order_id' => [PurchaseOrder::class, 'reference'],
        'user_id'           => [User::class, 'name'],
        'created_by'        => [User::class, 'name'],
        'approved_by'       => [User::class, 'name'],
        'received_by'       => [User::class, 'name'],
        'voided_by'         => [User::class, 'name'],
        'waiter_id'         => [User::class, 'name'],
    ];

    /** Models whose quantities live in child rows that only exist after the parent's "created" event. */
    private const WITH_LINE_ITEMS = [
        Sale::class, Refund::class, PurchaseOrder::class, GoodsReceipt::class, Quotation::class,
        StockAdjustment::class, StockTransfer::class, StockCount::class, Stocktake::class,
    ];

    public static function hasLineItems(Model $model): bool
    {
        return in_array(get_class($model), self::WITH_LINE_ITEMS, true);
    }

    /**
     * Resolves every known *_id in the given value arrays to a name:
     * ['warehouse_id' => ['2' => 'Main Warehouse'], ...]. Keyed by id so an
     * "updated" row can show both the old and the new name.
     */
    public static function refs(array ...$valueSets): array
    {
        $refs = [];
        foreach ($valueSets as $values) {
            foreach ($values as $field => $id) {
                if (!isset(self::REFS[$field]) || $id === null || $id === '' || !is_scalar($id)) continue;
                if (isset($refs[$field][(string) $id])) continue;
                [$class, $column] = self::REFS[$field];
                $name = self::lookup($class, $column, $id);
                if ($name !== null) $refs[$field][(string) $id] = $name;
            }
        }
        return $refs;
    }

    /** Detail that doesn't depend on child rows, so it can be captured the moment the event fires. */
    public static function immediate(Model $model, string $event): array
    {
        $extra = [];

        if ($model instanceof Layby) {
            $extra['items'] = collect($model->items ?? [])->map(fn ($i) => [
                'product_name' => $i['name'] ?? $i['product_name'] ?? null,
                'quantity'     => $i['quantity'] ?? null,
                'unit_price'   => $i['unit_price'] ?? null,
            ])->values()->all();
        }

        if ($model instanceof \App\Models\IngredientStockAdjustment) {
            $ingredient = Ingredient::withoutGlobalScopes()->find($model->ingredient_id);
            $extra['items'] = [[
                'product_name'      => $ingredient?->name,
                'product_sku'       => $ingredient?->sku,
                'unit'              => $ingredient?->stock_unit,
                'quantity_before'   => $model->quantity_before,
                'quantity_adjusted' => $model->quantity_adjusted,
                'quantity_after'    => $model->quantity_after,
            ]];
        }

        // A product's own row doesn't hold its stock, so an edit or deletion
        // would otherwise not say how much stock there was at the time.
        // (Opening stock on creation is attached by ProductController::store,
        // since the stock row is written after the product.)
        if ($model instanceof Product && $event !== 'created') {
            $extra['stock_on_hand'] = (float) \App\Models\Stock::where('product_id', $model->getKey())->sum('quantity');
        }

        return $extra;
    }

    /** Products/ingredients and their quantities for a parent record (sale, PO, adjustment, ...). */
    public static function lineItems(Model $model): array
    {
        // Branch/soft-delete scopes would hide a product that has since been
        // deleted or belongs to another branch, leaving the name blank.
        $unscoped = fn ($q) => $q->withoutGlobalScopes();

        try {
            return match (true) {
                $model instanceof Sale => $model->items()->with(['product' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_name' => $i->product?->name,
                        'product_sku'  => $i->product?->sku,
                        'quantity'     => (float) $i->quantity,
                        'unit_price'   => (float) $i->unit_price,
                        'discount'     => (float) $i->discount_amount,
                        'total'        => (float) $i->total,
                    ])->all(),

                $model instanceof Refund => $model->items()->with(['saleItem.product' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_name' => $i->saleItem?->product?->name,
                        'product_sku'  => $i->saleItem?->product?->sku,
                        'quantity'     => (float) $i->quantity,
                        'total'        => (float) $i->amount,
                        'restocked'    => $i->restock ? 'Yes' : 'No',
                    ])->all(),

                $model instanceof PurchaseOrder => $model->items()->with(['product' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_name'      => $i->product?->name,
                        'product_sku'       => $i->product?->sku,
                        'quantity'          => (float) $i->quantity,
                        'received_quantity' => (float) $i->received_quantity,
                        'unit_price'        => (float) $i->unit_cost,
                        'total'             => (float) $i->subtotal,
                    ])->all(),

                $model instanceof GoodsReceipt => $model->items()->with(['product' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_name' => $i->product?->name,
                        'product_sku'  => $i->product?->sku,
                        'quantity'     => (float) $i->quantity,
                        'unit_price'   => (float) $i->unit_cost,
                        'batch'        => $i->batch_number,
                    ])->all(),

                $model instanceof Quotation => $model->items()->with(['product' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_name' => $i->name ?: $i->product?->name,
                        'product_sku'  => $i->product?->sku,
                        'quantity'     => (float) $i->quantity,
                        'unit_price'   => (float) $i->unit_price,
                        'total'        => (float) $i->subtotal,
                    ])->all(),

                $model instanceof StockAdjustment => $model->items()->with(['product' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_id'        => $i->product_id,
                        'product_name'      => $i->product?->name,
                        'product_sku'       => $i->product?->sku,
                        'quantity_before'   => (float) $i->quantity_before,
                        'quantity_adjusted' => (float) $i->quantity_adjusted,
                        'quantity_after'    => (float) $i->quantity_after,
                        'cost_price'        => (float) $i->cost_price,
                    ])->all(),

                $model instanceof StockTransfer => $model->items()->with(['product' => $unscoped])->get()
                    ->map(fn ($i) => array_filter([
                        'product_id'        => $i->product_id,
                        'product_name'      => $i->product?->name,
                        'product_sku'       => $i->product?->sku,
                        'quantity'          => (float) $i->quantity,
                        'received_quantity' => $i->received_quantity !== null ? (float) $i->received_quantity : null,
                    ], fn ($v) => $v !== null))->all(),

                $model instanceof StockCount => $model->items()->with(['product' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_name' => $i->product?->name,
                        'product_sku'  => $i->product?->sku,
                        'expected'     => (float) $i->system_quantity,
                        'counted'      => (float) $i->counted_quantity,
                        'variance'     => (float) $i->difference,
                    ])->all(),

                $model instanceof Stocktake => $model->items()->with(['product' => $unscoped, 'ingredient' => $unscoped])->get()
                    ->map(fn ($i) => [
                        'product_name' => $i->product?->name ?? $i->ingredient?->name,
                        'product_sku'  => $i->product?->sku ?? $i->ingredient?->sku,
                        'expected'     => (float) $i->expected_qty,
                        'counted'      => $i->counted_qty !== null ? (float) $i->counted_qty : null,
                        'variance'     => $i->variance !== null ? (float) $i->variance : null,
                    ])->all(),

                default => [],
            };
        } catch (\Throwable) {
            return [];
        }
    }

    private static function lookup(string $class, string $column, $id): ?string
    {
        static $cache = [];
        $key = "{$class}:{$id}";
        if (!array_key_exists($key, $cache)) {
            try {
                $query = $class::query()->withoutGlobalScopes(); // also drops SoftDeletes, so deleted rows still resolve
                $cache[$key] = $query->whereKey($id)->value($column);
            } catch (\Throwable) {
                $cache[$key] = null;
            }
        }
        return $cache[$key];
    }
}
