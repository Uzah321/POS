<?php

namespace Tests\Unit;

use App\Models\AuditLog;
use PHPUnit\Framework\TestCase;

/**
 * Audit log entries must say which product was touched, by how much and
 * what was done — not just "StockAdjustment #5 created".
 */
class AuditLogDescriptionTest extends TestCase
{
    private function log(string $event, string $model, ?array $old, ?array $new, int $id = 5): AuditLog
    {
        return new AuditLog([
            'event' => $event, 'auditable_type' => "App\\Models\\{$model}", 'auditable_id' => $id,
            'old_values' => $old, 'new_values' => $new,
        ]);
    }

    public function test_stock_adjustment_names_product_quantity_and_warehouse(): void
    {
        $log = $this->log('created', 'StockAdjustment', null, [
            'warehouse_id' => 1, 'type' => 'damage', 'reason' => 'Dropped crate',
            'items' => [['product_name' => 'Coke 500ml', 'quantity_before' => '5.000', 'quantity_adjusted' => -2, 'quantity_after' => 3]],
            '_refs' => ['warehouse_id' => ['1' => 'Main Warehouse']],
        ]);

        $this->assertSame(
            'Stock written off (damage/wastage) at Main Warehouse — Coke 500ml -2 (5 → 3) · Reason: Dropped crate',
            $log->description,
        );
    }

    public function test_sale_lists_products_and_quantities(): void
    {
        $log = $this->log('created', 'Sale', null, [
            'reference' => 'SALE-1', 'status' => 'completed', 'total' => '29.00', 'customer_id' => 3,
            'items' => [
                ['product_name' => 'Coke 500ml', 'quantity' => 2.0, 'unit_price' => 12.0, 'total' => 24.0],
                ['product_name' => 'Bread', 'quantity' => 1.0, 'unit_price' => 5.0, 'total' => 5.0],
            ],
            '_refs' => ['customer_id' => ['3' => 'Jane Moyo']],
        ]);

        $this->assertSame(
            'Sale SALE-1 created (Customer: Jane Moyo, Status: completed, Total: 29.00) — 2 × Coke 500ml, 1 × Bread',
            $log->description,
        );
    }

    public function test_update_shows_names_instead_of_ids(): void
    {
        $log = $this->log('updated', 'Product',
            ['category_id' => 1, 'selling_price' => '10.00'],
            ['category_id' => 2, 'selling_price' => '12.00', 'name' => 'Coke 500ml',
             '_refs' => ['category_id' => ['1' => 'Drinks', '2' => 'Snacks']]],
        );

        $this->assertSame("Product 'Coke 500ml' updated: Category: Drinks → Snacks, Selling Price: 10 → 12", $log->description);
    }

    public function test_update_hides_unchanged_values_and_shows_stock_on_hand(): void
    {
        $log = $this->log('updated', 'Product',
            ['cost_price' => '1.67', 'reorder_level' => 5],
            ['cost_price' => '1.167', 'reorder_level' => '5.000', 'name' => 'Guarana', 'stock_on_hand' => 24.0],
        );

        $this->assertSame("Product 'Guarana' updated: Cost Price: 1.67 → 1.167 · Stock on hand: 24", $log->description);
        $this->assertCount(1, $log->changes());
    }

    public function test_product_created_shows_opening_stock(): void
    {
        $log = $this->log('created', 'Product', null, [
            'name' => 'Hunters', 'sku' => 'OYJ-1', 'selling_price' => '1.50', 'cost_price' => '1.167',
            'opening_stock' => 24, 'opening_stock_warehouse' => 'Main Warehouse',
        ]);

        $this->assertSame(
            "Product 'Hunters' created (SKU: OYJ-1, Price: 1.50, Cost: 1.17, Opening stock: 24 at Main Warehouse)",
            $log->description,
        );
    }

    public function test_ingredient_adjustment_includes_unit(): void
    {
        $log = $this->log('created', 'IngredientStockAdjustment', null, [
            'type' => 'in', 'warehouse_id' => 1,
            'items' => [['product_name' => 'Flour', 'unit' => 'kg', 'quantity_before' => 1, 'quantity_adjusted' => 2.5, 'quantity_after' => 3.5]],
        ]);

        $this->assertSame('Ingredient stock added at 1 — Flour +2.5 kg (1 → 3.5)', $log->description);
    }
    public function test_product_created_reports_opening_stock_as_quantity_added(): void
    {
        $log = $this->log('created', 'Product', null, ['name' => 'Hunters', 'opening_stock' => 24]);
        $this->assertSame(['quantity' => 24.0, 'stock_after' => 24.0], $log->stock_movement);
    }

    public function test_import_overwrite_reports_signed_quantity_change(): void
    {
        $log = $this->log('updated', 'Product', ['stock_quantity' => 10], ['stock_quantity' => 4, 'stock_on_hand' => 6]);
        $this->assertSame(['quantity' => -6.0, 'stock_after' => 6.0], $log->stock_movement);
    }

    public function test_product_deleted_reports_stock_removed(): void
    {
        $log = $this->log('deleted', 'Product', ['name' => 'Guarana', 'stock_on_hand' => 3], null);
        $this->assertSame(['quantity' => -3.0, 'stock_after' => 0.0], $log->stock_movement);
    }

    public function test_plain_product_edit_has_no_stock_movement(): void
    {
        $log = $this->log('updated', 'Product', ['cost_price' => 1.67], ['cost_price' => 1.167, 'stock_on_hand' => 12]);
        $this->assertNull($log->stock_movement);
    }
}
