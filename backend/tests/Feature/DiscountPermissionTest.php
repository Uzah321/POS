<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Stock;
use App\Models\User;
use App\Models\Warehouse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The POS Discount key: a sale (or a tab's items) at a discount needs the
 * apply_discounts permission — managers and admins, not cashiers.
 */
class DiscountPermissionTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private Product $steak;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH-MAIN', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->steak = Product::create([
            'name' => 'T-bone', 'slug' => 't-bone', 'sku' => 'TBONE', 'branch_id' => $this->branch->id,
            'cost_price' => 3, 'selling_price' => 5.50, 'is_active' => true, 'is_taxable' => false, 'track_stock' => true,
        ]);
        Stock::create(['product_id' => $this->steak->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);
    }

    /** Two T-bones at 10% off: the line's discount is for both (2 × 0.55). */
    private function sellDiscounted(User $user, array $line = ['discount_type' => 'fixed', 'discount_value' => 1.10]): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($user, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => [['product_id' => $this->steak->id, 'quantity' => 2, 'unit_price' => 5.50] + $line],
            'payments' => [['method' => 'cash', 'amount' => 9.90]],
        ]);
    }

    public function test_a_cashier_cannot_sell_at_a_discount(): void
    {
        $cashier = User::factory()->create(['branch_id' => $this->branch->id]);

        $this->sellDiscounted($cashier)->assertForbidden();
        $this->assertSame(0, Sale::count());
    }

    public function test_a_manager_can_and_the_discount_covers_the_whole_line(): void
    {
        $manager = User::factory()->create(['branch_id' => $this->branch->id]);
        $manager->givePermissionTo('apply_discounts');

        $this->sellDiscounted($manager)->assertCreated();
        $this->assertEqualsWithDelta(9.90, (float) Sale::firstOrFail()->total, 0.000001);
    }

    public function test_a_sale_without_a_discount_needs_no_permission(): void
    {
        $cashier = User::factory()->create(['branch_id' => $this->branch->id]);

        $this->sellDiscounted($cashier, ['discount_type' => null, 'discount_value' => 0])->assertCreated();
    }

    public function test_items_added_to_a_tab_at_a_discount_need_it_too(): void
    {
        $cashier = User::factory()->create(['branch_id' => $this->branch->id]);
        $tab = $this->actingAs($cashier, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'status' => 'open',
            'items' => [['product_id' => $this->steak->id, 'quantity' => 1, 'unit_price' => 5.50]],
        ])->assertCreated()->json('data.id');

        $this->actingAs($cashier, 'sanctum')->postJson("/api/sales/{$tab}/add-items", [
            'items' => [['product_id' => $this->steak->id, 'quantity' => 1, 'unit_price' => 5.50, 'discount_type' => 'fixed', 'discount_value' => 0.55]],
        ])->assertForbidden();
    }
}
