<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\RestaurantTable;
use App\Models\Sale;
use App\Models\Stock;
use App\Models\User;
use App\Models\Warehouse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * Tables a waiter served. A tab opened from a table sent only its id, so the
 * sale had no table number and Sales by Waiter said the waiter served none.
 */
class SalesByWaiterTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private Product $stew;
    private RestaurantTable $table;
    private User $cashier;
    private User $waiter;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH-MAIN', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->stew = Product::create([
            'name' => 'Beef Stew', 'slug' => 'beef-stew', 'sku' => 'STEW', 'branch_id' => $this->branch->id,
            'cost_price' => 2, 'selling_price' => 5.50, 'is_active' => true, 'is_taxable' => true, 'track_stock' => true,
        ]);
        Stock::create(['product_id' => $this->stew->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);
        $this->table = RestaurantTable::create(['branch_id' => $this->branch->id, 'name' => 'Table 1', 'seats' => 4]);

        $viewReports = Permission::firstOrCreate(['name' => 'view_reports', 'guard_name' => 'web']);
        Role::firstOrCreate(['name' => 'manager', 'guard_name' => 'web'])->givePermissionTo($viewReports);
        $this->cashier = tap(User::factory()->create(['branch_id' => $this->branch->id]))->assignRole('manager');
        $this->waiter = User::factory()->create(['branch_id' => $this->branch->id, 'name' => 'Tendai']);
    }

    private function openTab(): Sale
    {
        $id = $this->actingAs($this->cashier, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'table_id' => $this->table->id,
            'waiter_id' => $this->waiter->id,
            'order_type' => 'sit_in',
            'status' => 'open',
            'items' => [['product_id' => $this->stew->id, 'quantity' => 1, 'unit_price' => 5.50]],
        ])->assertCreated()->json('data.id');

        return Sale::findOrFail($id);
    }

    public function test_a_tab_opened_on_a_table_carries_its_name(): void
    {
        $this->assertSame('Table 1', $this->openTab()->table_number);
    }

    public function test_the_waiter_is_credited_with_the_table_they_served(): void
    {
        $sale = $this->openTab();
        $this->postJson("/api/sales/{$sale->id}/close-tab", ['payments' => [['method' => 'cash', 'amount' => 5.50]]])->assertOk();

        $today = now()->toDateString();
        $this->getJson("/api/reports/sales-by-waiter?date_from={$today}&date_to={$today}")
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Tendai')
            ->assertJsonPath('data.0.tables_served', 1);
    }
}
