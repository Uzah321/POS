<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Stock;
use App\Models\User;
use App\Models\Warehouse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A scale label rounded to 0.05: 0.526 kg of tripe at 3.49/kg prints 1.85.
 * The till charges 1.85 (unit price 1.85 / 0.526) but shows 3.49/kg, as the
 * label does, and the sale keeps that 3.49 for reprints and sales history.
 */
class ScaleLabelPriceTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private User $cashier;
    private Product $tripe;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH-MAIN', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->cashier = User::factory()->create(['branch_id' => $this->branch->id]);
        $this->tripe = Product::create([
            'name' => 'TRIPE', 'slug' => 'tripe', 'branch_id' => $this->branch->id, 'sold_by_weight' => true,
            'cost_price' => 0, 'selling_price' => 3.49, 'is_active' => true, 'track_stock' => false,
        ]);
        Stock::create(['product_id' => $this->tripe->id, 'warehouse_id' => $warehouse->id, 'quantity' => 100]);
    }

    private function sell(array $item): array
    {
        return $this->actingAs($this->cashier, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => [['product_id' => $this->tripe->id, 'quantity' => 0.526] + $item],
            'payments' => [['method' => 'cash', 'amount' => 2]],
        ])->assertCreated()->json('data');
    }

    public function test_a_rounded_label_charges_its_total_and_keeps_its_price_per_kg(): void
    {
        $sale = $this->sell(['unit_price' => 1.85 / 0.526, 'label_price' => 3.49]);

        $this->assertSame('1.85', number_format((float) $sale['total'], 2));
        $this->assertSame('1.85', number_format((float) $sale['items'][0]['total'], 2));
        $this->assertSame('3.490000', $sale['items'][0]['label_price']);

        // Read back later (Sales History, a reprint), it still shows 3.49/kg.
        $stored = $this->actingAs($this->cashier, 'sanctum')->getJson("/api/sales/{$sale['id']}")->assertOk()->json('data');
        $this->assertSame('3.490000', $stored['items'][0]['label_price']);
    }

    public function test_any_other_line_has_no_label_price(): void
    {
        $sale = $this->sell(['unit_price' => 3.49]);

        $this->assertNull($sale['items'][0]['label_price']);
        $this->assertSame('1.84', number_format((float) $sale['total'], 2));
    }
}
