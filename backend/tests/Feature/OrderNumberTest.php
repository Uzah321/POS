<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Sale;
use App\Models\User;
use App\Models\Warehouse;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Every sale gets an order number that counts up per branch and starts again
 * at 1 once Day End has been run for that branch.
 */
class OrderNumberTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Branch $branch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::where('username', 'admin')->firstOrFail();
        $this->branch = Branch::where('code', 'MAIN')->firstOrFail();
    }

    private function sale(?Branch $branch = null): Sale
    {
        $branch ??= $this->branch;
        $warehouse = Warehouse::firstOrCreate(['branch_id' => $branch->id], ['name' => "{$branch->name} WH", 'code' => "WH-{$branch->code}", 'is_default' => true, 'is_active' => true]);
        return Sale::create([
            'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'user_id' => $this->admin->id,
            'status' => 'completed', 'subtotal' => 10, 'total' => 10, 'amount_paid' => 10, 'completed_at' => now(),
        ]);
    }

    private function runDayEnd(): void
    {
        $this->actingAs($this->admin)->postJson('/api/end-of-day', [
            'branch_id' => $this->branch->id, 'report_date' => now()->toDateString(), 'opening_cash' => 0, 'actual_cash' => 0,
        ])->assertSuccessful();
    }

    public function test_order_numbers_count_up_and_start_again_after_day_end(): void
    {
        // All in the same second as the demo sales and each Day End — the
        // reset mustn't depend on the clock moving on
        $this->runDayEnd();
        $this->assertSame([1, 2, 3], [$this->sale()->order_number, $this->sale()->order_number, $this->sale()->order_number]);

        // The next day, before Day End has been run: still counting
        $this->travel(1)->days();
        $this->assertSame(4, $this->sale()->order_number);

        $this->runDayEnd();
        $this->assertSame([1, 2], [$this->sale()->order_number, $this->sale()->order_number]);
    }

    public function test_a_day_end_from_before_order_numbers_resets_by_its_time(): void
    {
        \App\Models\EndOfDay::create([
            'branch_id' => $this->branch->id, 'user_id' => $this->admin->id, 'report_date' => now()->toDateString(),
            'opening_cash' => 0, 'actual_cash' => 0, 'expected_cash' => 0, 'difference' => 0, 'status' => 'closed',
        ]);
        $this->travel(1)->minutes();
        $this->assertSame([1, 2], [$this->sale()->order_number, $this->sale()->order_number]);
    }

    public function test_each_branch_has_its_own_numbers(): void
    {
        $this->runDayEnd();
        $other = Branch::create(['name' => 'Second Shop', 'code' => 'SEC', 'currency' => 'USD', 'is_active' => true]);

        $this->assertSame(1, $this->sale()->order_number);
        $this->assertSame(1, $this->sale($other)->order_number);
        $this->assertSame(2, $this->sale()->order_number);

        // Next day's Day End in the main branch leaves the other branch's count alone
        $this->travel(1)->days();
        $this->runDayEnd();
        $this->assertSame(1, $this->sale()->order_number);
        $this->assertSame(2, $this->sale($other)->order_number);
    }

    public function test_the_kitchen_and_queue_screens_show_the_order_number(): void
    {
        $this->runDayEnd();
        $this->sale();
        $sale = $this->sale();
        $product = \App\Models\Product::create([
            'name' => 'Burger', 'slug' => 'burger-' . uniqid(), 'sku' => 'BURG-' . uniqid(), 'branch_id' => $this->branch->id,
            'selling_price' => 10, 'cost_price' => 4, 'made_to_order' => true, 'is_active' => true,
        ]);
        $sale->items()->create(['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10, 'total' => 10, 'subtotal' => 10]);
        $sale->update(['kds_status' => 'new']);

        $tickets = collect($this->getJson('/api/kds/orders?branch_id=' . $this->branch->id)->assertOk()->json('data'))->pluck('ticket', 'id');
        $this->assertSame('#2', $tickets[$sale->id]);
    }
}
