<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Stock;
use App\Models\User;
use App\Models\Warehouse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * Products from the Excel stock import had no branch, and every till lists
 * (and a sale accepts) only its own branch's products — so a uniform shop's
 * 2,393 imported products could not be found or sold by anyone at a till.
 */
class ImportedProductsInBranchTest extends TestCase
{
    use RefreshDatabase;

    private Branch $main;
    private Warehouse $warehouse;
    private User $admin;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->main = Branch::create(['name' => 'Main Branch', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $this->warehouse = Warehouse::create(['name' => 'Main Warehouse', 'code' => 'WH-MAIN', 'branch_id' => $this->main->id, 'is_active' => true, 'is_default' => true]);

        $this->admin = User::factory()->create(['branch_id' => $this->main->id]);
        Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web']);
        $this->admin->assignRole('admin');
        $this->cashier = User::factory()->create(['branch_id' => $this->main->id]);
    }

    /** What a till in Main Branch lists for this user (the tills send their branch). */
    private function tillProducts(User $user): array
    {
        $json = $this->actingAs($user, 'sanctum')
            ->getJson('/api/products?is_active=1&per_page=500&branch_id=' . $this->main->id)
            ->assertOk()->json('data');

        return collect($json['data'] ?? $json)->pluck('name')->sort()->values()->all();
    }

    private function import(array $rows): void
    {
        $this->actingAs($this->admin, 'sanctum')->postJson('/api/inventory/import', [
            'warehouse_id' => $this->warehouse->id,
            'rows' => $rows,
        ])->assertOk();
    }

    public function test_imported_products_belong_to_the_warehouses_branch_and_reach_the_tills(): void
    {
        $this->import([
            ['name' => 'DWALENI SHIRT 28', 'sku' => '161', 'barcode' => '1518', 'selling_price' => 9, 'quantity' => 4],
            ['name' => 'MINDA BLAZER 40', 'sku' => '1707', 'selling_price' => 25, 'quantity' => 2],
        ]);

        $this->assertSame(2, Product::where('branch_id', $this->main->id)->count());
        $this->assertSame(['DWALENI SHIRT 28', 'MINDA BLAZER 40'], $this->tillProducts($this->cashier));
        $this->assertSame(['DWALENI SHIRT 28', 'MINDA BLAZER 40'], $this->tillProducts($this->admin));

        // ...and can be sold there.
        $shirt = Product::where('sku', '161')->firstOrFail();
        $this->actingAs($this->cashier, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->main->id,
            'items' => [['product_id' => $shirt->id, 'quantity' => 1, 'unit_price' => 9]],
            'payments' => [['method' => 'cash', 'amount' => 9]],
        ])->assertCreated();
    }

    public function test_reimporting_a_product_left_without_a_branch_puts_it_in_the_branch(): void
    {
        $old = Product::create(['name' => 'GREEN SOCKS', 'slug' => 'green-socks', 'sku' => '356', 'business_type' => 'both',
            'cost_price' => 1, 'selling_price' => 2, 'is_active' => true, 'track_stock' => true]);

        $this->import([['name' => 'GREEN SOCKS', 'sku' => '356', 'selling_price' => 2.5, 'quantity' => 10]]);

        $this->assertSame(1, Product::count());
        $this->assertSame($this->main->id, $old->fresh()->branch_id);
        $this->assertSame(['GREEN SOCKS'], $this->tillProducts($this->cashier));
    }

    public function test_the_repair_migration_puts_branchless_products_in_a_branch(): void
    {
        $town = Branch::create(['name' => 'Town', 'code' => 'TOWN', 'currency' => 'USD', 'is_active' => true]);
        $townWarehouse = Warehouse::create(['name' => 'Town WH', 'code' => 'WH-TOWN', 'branch_id' => $town->id, 'is_active' => true]);
        $make = fn (string $name, string $sku) => Product::create(['name' => $name, 'slug' => strtolower($sku), 'sku' => $sku,
            'business_type' => 'both', 'cost_price' => 1, 'selling_price' => 2, 'is_active' => true, 'track_stock' => true]);

        $inMain = $make('SLACK GREEN 38', 'A1');
        Stock::create(['product_id' => $inMain->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 3]);
        $inTown = $make('SLACK BLUE 34', 'A2');
        Stock::create(['product_id' => $inTown->id, 'warehouse_id' => $townWarehouse->id, 'quantity' => 3]);
        $noStock = $make('SCHOOL SHOE 1', 'A3');          // two branches, no stock: can't tell
        $clash = $make('JERSEY GREEN 26', 'A4');           // Main already has SKU A4
        Stock::create(['product_id' => $clash->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 1]);
        Product::create(['name' => 'Jersey Green (new)', 'slug' => 'jg', 'sku' => 'A4', 'branch_id' => $this->main->id,
            'business_type' => 'both', 'cost_price' => 1, 'selling_price' => 2, 'is_active' => true, 'track_stock' => true]);

        (require database_path('migrations/2026_11_14_000001_attach_branchless_products_to_their_branch.php'))->up();

        $this->assertSame($this->main->id, $inMain->fresh()->branch_id);
        $this->assertSame($town->id, $inTown->fresh()->branch_id);
        $this->assertNull($noStock->fresh()->branch_id);
        $this->assertNull($clash->fresh()->branch_id);
    }

    public function test_with_one_branch_the_repair_migration_takes_every_product(): void
    {
        $make = fn (string $name, string $sku) => Product::create(['name' => $name, 'slug' => strtolower($sku), 'sku' => $sku,
            'business_type' => 'both', 'cost_price' => 1, 'selling_price' => 2, 'is_active' => true, 'track_stock' => true]);
        $make('THREE LEAVES 1', 'B1');
        $make('INVERTED GREEN 36', 'B2');

        (require database_path('migrations/2026_11_14_000001_attach_branchless_products_to_their_branch.php'))->up();

        $this->assertSame(0, Product::whereNull('branch_id')->count());
        $this->assertSame(['INVERTED GREEN 36', 'THREE LEAVES 1'], $this->tillProducts($this->cashier));
    }
}
