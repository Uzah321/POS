<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Stock;
use App\Models\User;
use App\Models\Warehouse;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A refund comes off the sales totals: the dashboard, Sales History, and
 * the cashier's shift (where it also leaves the drawer with less cash).
 */
class RefundReducesSalesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Branch $branch;
    private Product $soap;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::where('username', 'admin')->firstOrFail();
        $this->branch = Branch::where('code', 'MAIN')->firstOrFail();
        // Start from a day with no demo sales
        $this->travel(2)->days();

        $this->soap = Product::create([
            'name' => 'Bath Soap', 'slug' => 'bath-soap', 'sku' => 'SOAP', 'branch_id' => $this->branch->id,
            'cost_price' => 1, 'selling_price' => 5, 'is_active' => true, 'is_taxable' => false, 'track_stock' => true,
        ]);
        $warehouse = Warehouse::where('branch_id', $this->branch->id)->firstOrFail();
        Stock::create(['product_id' => $this->soap->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);
    }

    /** Sells two soaps for $10 cash and refunds one of them. */
    private function sellTwoAndRefundOne(): void
    {
        $sale = $this->actingAs($this->admin)->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => [['product_id' => $this->soap->id, 'quantity' => 2, 'unit_price' => 5]],
            'payments' => [['method' => 'cash', 'amount' => 10]],
        ])->assertCreated()->json('data');

        $this->actingAs($this->admin)->postJson('/api/refunds', [
            'sale_id' => $sale['id'],
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();
    }

    private function dashboardToday(): array
    {
        return $this->actingAs($this->admin)->getJson('/api/reports/dashboard')->assertOk()->json('data.today');
    }

    public function test_the_dashboards_sales_today_drop_by_the_refund_straight_away(): void
    {
        $this->actingAs($this->admin)->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => [['product_id' => $this->soap->id, 'quantity' => 1, 'unit_price' => 5]],
            'payments' => [['method' => 'cash', 'amount' => 5]],
        ])->assertCreated();
        $this->assertEquals(5, $this->dashboardToday()['revenue']);

        // Within the dashboard's cache window — the refund mustn't wait it out
        $this->sellTwoAndRefundOne();

        $today = $this->dashboardToday();
        $this->assertEquals(10, $today['revenue']);
        $this->assertEquals(5, $today['refunds']);
        $this->assertEquals(10, $today['net']);
        $this->assertEquals(5, $today['avg_sale']);
    }

    public function test_sales_history_total_is_after_refunds(): void
    {
        $this->sellTwoAndRefundOne();

        $summary = $this->actingAs($this->admin)->getJson('/api/sales?date_from=' . now()->toDateString())->assertOk()->json('summary');
        $this->assertEquals(5, $summary['total']);
        $this->assertEquals(5, $summary['refunded']);
        $this->assertSame(1, $summary['count']);
    }

    public function test_the_shift_takes_the_refund_off_sales_and_expected_cash(): void
    {
        $this->sellTwoAndRefundOne();

        $shift = $this->actingAs($this->admin)->getJson('/api/shift-end/summary')->assertOk()->json('data');
        $this->assertEquals(5, $shift['total_sales']);
        $this->assertEquals(5, $shift['total_refunds']);
        $this->assertEquals(10, $shift['cash_sales']);
        $this->assertEquals(5, $shift['expected_cash']);

        $closed = $this->actingAs($this->admin)->postJson('/api/shift-end', ['declared_cash' => 5])->assertCreated()->json('data');
        $this->assertEquals(5, $closed['total_sales']);
        $this->assertEquals(5, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']);
    }
}
