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
 * A till whose reply got lost (dropped connection, or it stopped waiting)
 * sends the same sale again. Empire Meats' till did this every 20 seconds on
 * a bad line and one $2 label was saved 12 times. A resend carries the same
 * client_ref, and the server answers with the sale it already has.
 */
class ResentSaleTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private Warehouse $warehouse;
    private User $cashier;
    private Product $mince;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $this->warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH-MAIN', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->cashier = User::factory()->create(['branch_id' => $this->branch->id]);
        $this->mince = Product::create([
            'name' => 'MINCE', 'slug' => 'mince', 'branch_id' => $this->branch->id,
            'cost_price' => 1, 'selling_price' => 2, 'is_active' => true, 'track_stock' => true,
        ]);
        Stock::create(['product_id' => $this->mince->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 10]);
    }

    private function send(?string $clientRef)
    {
        return $this->actingAs($this->cashier, 'sanctum')->postJson('/api/sales', array_filter([
            'branch_id' => $this->branch->id,
            'items' => [['product_id' => $this->mince->id, 'quantity' => 1, 'unit_price' => 2]],
            'payments' => [['method' => 'cash', 'amount' => 2]],
            'client_ref' => $clientRef,
        ], fn ($v) => $v !== null));
    }

    private function stockLeft(): float
    {
        return (float) Stock::where('product_id', $this->mince->id)->where('warehouse_id', $this->warehouse->id)->value('quantity');
    }

    public function test_a_resent_sale_is_saved_once_and_answered_with_the_first(): void
    {
        $first = $this->send('till-1-sale-abc')->assertCreated()->json('data');

        $again = $this->send('till-1-sale-abc')->assertOk()->assertJsonPath('message', 'Sale already recorded')->json('data');
        $this->send('till-1-sale-abc')->assertOk();

        $this->assertSame($first['id'], $again['id']);
        $this->assertSame($first['reference'], $again['reference']);
        $this->assertCount(1, $again['items']);
        $this->assertSame(1, Sale::count());
        $this->assertSame(9.0, $this->stockLeft()); // taken once, not three times
    }

    public function test_the_same_basket_sold_again_as_a_new_sale_still_counts(): void
    {
        $this->send('till-1-sale-abc')->assertCreated();
        $this->send('till-1-sale-def')->assertCreated();

        $this->assertSame(2, Sale::count());
        $this->assertSame(8.0, $this->stockLeft());
    }

    public function test_a_till_that_sends_no_ref_works_as_before(): void
    {
        $this->send(null)->assertCreated();
        $this->send(null)->assertCreated();

        $this->assertSame(2, Sale::count());
        $this->assertNull(Sale::first()->client_ref);
    }
}
