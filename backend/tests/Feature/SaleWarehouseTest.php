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
 * Which warehouse a sale's stock comes out of. The tills sent warehouse 1
 * whatever the branch; after a factory reset recreated the warehouses there
 * was no warehouse 1, and every sale was refused.
 */
class SaleWarehouseTest extends TestCase
{
    use RefreshDatabase;

    private Warehouse $mainWarehouse;
    private Warehouse $townWarehouse;
    private Branch $town;
    private Product $stew;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $main = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $this->town = Branch::create(['name' => 'Town', 'code' => 'TOWN', 'currency' => 'USD', 'is_active' => true]);
        $this->mainWarehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH-MAIN', 'branch_id' => $main->id, 'is_active' => true, 'is_default' => true]);
        $this->townWarehouse = Warehouse::create(['name' => 'Town WH', 'code' => 'WH-TOWN', 'branch_id' => $this->town->id, 'is_active' => true, 'is_default' => true]);

        $this->stew = Product::create([
            'name' => 'Beef Stew', 'slug' => 'beef-stew', 'sku' => 'STEW', 'branch_id' => $this->town->id,
            'cost_price' => 2, 'selling_price' => 5.50, 'is_active' => true, 'is_taxable' => true, 'track_stock' => true,
        ]);
        Stock::create(['product_id' => $this->stew->id, 'warehouse_id' => $this->townWarehouse->id, 'quantity' => 10]);

        $this->cashier = User::factory()->create(['branch_id' => $this->town->id]);
    }

    private function sell(array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->cashier, 'sanctum')->postJson('/api/sales', $extra + [
            'branch_id' => $this->town->id,
            'items' => [['product_id' => $this->stew->id, 'quantity' => 1, 'unit_price' => 5.50]],
            'payments' => [['method' => 'cash', 'amount' => 5.50]],
        ]);
    }

    private function stockLeft(Warehouse $warehouse): float
    {
        return (float) Stock::where('product_id', $this->stew->id)->where('warehouse_id', $warehouse->id)->value('quantity');
    }

    public function test_a_warehouse_that_no_longer_exists_sells_from_the_branchs_own(): void
    {
        $this->sell(['warehouse_id' => 9999])
            ->assertCreated()
            ->assertJsonPath('data.warehouse_id', $this->townWarehouse->id);

        $this->assertSame(9.0, $this->stockLeft($this->townWarehouse));
    }

    public function test_another_branchs_warehouse_isnt_used(): void
    {
        $this->sell(['warehouse_id' => $this->mainWarehouse->id])
            ->assertCreated()
            ->assertJsonPath('data.warehouse_id', $this->townWarehouse->id);
    }

    public function test_a_till_need_not_say_which_warehouse(): void
    {
        $this->sell()->assertCreated()->assertJsonPath('data.warehouse_id', $this->townWarehouse->id);
        $this->sell(['status' => 'open'])->assertCreated()->assertJsonPath('data.warehouse_id', $this->townWarehouse->id);

        $this->assertSame(8.0, $this->stockLeft($this->townWarehouse));
    }
}
