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
 * The dashboard starts again each day: today's sales, and the most sold
 * items (Popular Dishes / Top Selling Items) only from today's sales.
 */
class DashboardTodayTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Branch $branch;
    private Product $sadza;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::where('username', 'admin')->firstOrFail();
        $this->branch = Branch::where('code', 'MAIN')->firstOrFail();
        // Start from a day with no demo sales
        $this->travel(2)->days();

        $this->sadza = Product::create([
            'name' => 'Sadza White', 'slug' => 'sadza-white', 'sku' => 'SADZA', 'branch_id' => $this->branch->id,
            'cost_price' => 1, 'selling_price' => 2, 'is_active' => true, 'is_taxable' => false, 'track_stock' => true,
        ]);
        $warehouse = Warehouse::where('branch_id', $this->branch->id)->firstOrFail();
        Stock::create(['product_id' => $this->sadza->id, 'warehouse_id' => $warehouse->id, 'quantity' => 50]);
    }

    private function sell(int $quantity): void
    {
        $this->actingAs($this->admin)->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => [['product_id' => $this->sadza->id, 'quantity' => $quantity, 'unit_price' => 2]],
            'payments' => [['method' => 'cash', 'amount' => 2 * $quantity]],
        ])->assertCreated();
    }

    private function dashboard(): array
    {
        return $this->actingAs($this->admin)->getJson('/api/reports/dashboard')->assertOk()->json('data');
    }

    public function test_popular_items_are_todays_and_start_again_the_next_day(): void
    {
        $this->sell(3);
        $this->sell(2);

        $today = $this->dashboard();
        $this->assertSame('Sadza White', $today['top_products'][0]['product']['name']);
        $this->assertEquals(5, $today['top_products'][0]['total_qty']);

        $this->travel(1)->days();

        $nextDay = $this->dashboard();
        $this->assertSame([], $nextDay['top_products']);
        $this->assertEquals(0, $nextDay['today']['revenue']);
        $this->assertSame(0, $nextDay['today']['transactions']);

        $this->sell(1);

        $this->assertEquals(1, $this->dashboard()['top_products'][0]['total_qty']);
    }

    public function test_popular_items_list_the_whole_day_with_the_stock_left(): void
    {
        $this->sell(3);

        $warehouse = Warehouse::where('branch_id', $this->branch->id)->firstOrFail();
        $sold = ['product_id' => $this->sadza->id, 'quantity' => 1, 'unit_price' => 2];
        $items = [$sold];
        for ($i = 1; $i <= 34; $i++) {
            $dish = Product::create([
                'name' => "Dish $i", 'slug' => "dish-$i", 'sku' => "DISH$i", 'branch_id' => $this->branch->id,
                'cost_price' => 1, 'selling_price' => 2, 'is_active' => true, 'is_taxable' => false, 'track_stock' => true,
            ]);
            Stock::create(['product_id' => $dish->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);
            $items[] = ['product_id' => $dish->id, 'quantity' => 1, 'unit_price' => 2];
        }
        $this->actingAs($this->admin)->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => $items,
            'payments' => [['method' => 'cash', 'amount' => 2 * count($items)]],
        ])->assertCreated();

        $top = $this->dashboard()['top_products'];
        $this->assertCount(35, $top);

        $sadza = collect($top)->firstWhere('product.name', 'Sadza White');
        $this->assertEquals(4, $sadza['total_qty']);
        $this->assertEquals(46, $sadza['product']['total_stock']);
        $this->assertTrue($sadza['product']['track_stock']);
        $this->assertEquals(9, collect($top)->firstWhere('product.name', 'Dish 1')['product']['total_stock']);
    }
}
