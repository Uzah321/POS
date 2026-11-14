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
 * A sale is stored in USD (the base) and printed in the till's currency.
 * At R17 to the dollar a R1.00 item is $0.0588; stored to 2 decimals that
 * became $0.06, and the receipt printed R1.02.
 */
class SaleInOtherCurrencyTest extends TestCase
{
    use RefreshDatabase;

    private const ZAR = 17.0;

    private Branch $branch;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        Warehouse::create(['name' => 'Main WH', 'code' => 'WH-MAIN', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->cashier = User::factory()->create(['branch_id' => $this->branch->id]);
    }

    /** A product priced in rands, stored in USD as the Products page saves it. */
    private function product(float $rands): Product
    {
        $product = Product::create([
            'name' => "Item R{$rands}", 'slug' => 'item-' . uniqid(), 'branch_id' => $this->branch->id,
            'cost_price' => 0, 'selling_price' => $rands / self::ZAR, 'is_active' => true, 'track_stock' => false,
        ]);
        Stock::create(['product_id' => $product->id, 'warehouse_id' => Warehouse::first()->id, 'quantity' => 100]);

        return $product->fresh();
    }

    /** Sells as the till does: the product's USD price, and the rands tendered converted to USD. */
    private function sell(array $lines, float $tenderedRands): array
    {
        return $this->actingAs($this->cashier, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => array_map(fn ($l) => ['product_id' => $l[0]->id, 'quantity' => $l[1], 'unit_price' => (float) $l[0]->selling_price], $lines),
            'payments' => [['method' => 'cash', 'amount' => $tenderedRands / self::ZAR]],
        ])->assertCreated()->json('data');
    }

    private function rands(mixed $usd): string
    {
        return number_format((float) $usd * self::ZAR, 2, '.', '');
    }

    public function test_a_one_rand_item_prints_as_one_rand(): void
    {
        $sale = $this->sell([[$this->product(1), 1]], 1);

        $this->assertSame('1.00', $this->rands($sale['total']));
        $this->assertSame('1.00', $this->rands($sale['items'][0]['unit_price']));
        $this->assertSame('1.00', $this->rands($sale['items'][0]['total']));
        $this->assertSame('1.00', $this->rands($sale['payments'][0]['amount']));
        $this->assertSame('0.00', $this->rands($sale['change_due']));

        // Read back later (Sales History, a reprint), it's still R1.00.
        $stored = $this->actingAs($this->cashier, 'sanctum')->getJson("/api/sales/{$sale['id']}")->assertOk()->json('data');
        $this->assertSame('1.00', $this->rands($stored['total']));
    }

    public function test_a_basket_adds_up_in_rands(): void
    {
        $sale = $this->sell([[$this->product(1), 3], [$this->product(12.5), 2], [$this->product(0.5), 1]], 50);

        $this->assertSame('28.50', $this->rands($sale['total']));
        $this->assertSame('21.50', $this->rands($sale['change_due']));
    }

    public function test_an_item_under_a_us_cent_can_be_sold(): void
    {
        // R0.10 is $0.0059 — it used to fail "unit price must be at least 0.01".
        $sale = $this->sell([[$this->product(0.10), 1]], 0.10);

        $this->assertSame('0.10', $this->rands($sale['total']));
    }
}
