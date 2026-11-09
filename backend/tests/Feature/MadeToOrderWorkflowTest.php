<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Ingredient;
use App\Models\IngredientStock;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\Stock;
use App\Models\User;
use App\Models\Warehouse;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The life of a Made on Order item: create its ingredients, give it a recipe,
 * sell it, void or refund it — each step moving the ingredients' stock, never
 * a stock of the item's own.
 */
class MadeToOrderWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Branch $branch;
    private Warehouse $warehouse;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::where('username', 'admin')->firstOrFail();
        $this->branch = Branch::where('code', 'MAIN')->firstOrFail();
        $this->warehouse = Warehouse::defaultForBranch($this->branch->id);
    }

    private function createIngredient(array $data): Ingredient
    {
        $id = $this->actingAs($this->admin)->postJson('/api/ingredients', $data)->assertCreated()->json('data.id');
        return Ingredient::findOrFail($id);
    }

    private function stockOf(Ingredient $ingredient): float
    {
        return (float) IngredientStock::where('ingredient_id', $ingredient->id)->where('warehouse_id', $this->warehouse->id)->value('quantity');
    }

    /** A Made on Order "Pizza": 200 g flour and 0.1 kg cheese each. */
    private function pizza(Ingredient $flour, Ingredient $cheese): Product
    {
        $id = $this->actingAs($this->admin)->postJson('/api/products', [
            'name' => 'Pizza', 'sku' => 'PIZZA-1', 'branch_id' => $this->branch->id,
            'cost_price' => 0, 'selling_price' => 8, 'track_stock' => true, 'made_to_order' => true,
        ])->assertCreated()->json('data.id');

        $this->actingAs($this->admin)->putJson("/api/products/{$id}/ingredients", ['ingredients' => [
            ['ingredient_id' => $flour->id, 'quantity' => 200],
            ['ingredient_id' => $cheese->id, 'quantity' => 0.1],
        ]])->assertOk();

        return Product::findOrFail($id);
    }

    private function sell(Product $product, float $qty): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->admin)->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'items' => [['product_id' => $product->id, 'quantity' => $qty, 'unit_price' => 8]],
            'payments' => [['method' => 'cash', 'amount' => 8 * $qty]],
        ]);
    }

    public function test_an_ingredient_takes_part_units_and_a_cost_per_gram(): void
    {
        $flour = $this->createIngredient([
            'name' => 'Flour', 'sku' => '', 'barcode' => '', 'stock_unit' => '',
            'cost_price' => 0.0012, 'is_active' => true, 'initial_quantity' => 2.5,
        ]);

        $this->assertSame('0.001200', $flour->cost_price);
        $this->assertSame(2.5, $flour->total_stock);
        // In the branch's own warehouse, with where it came from in its history
        $this->assertSame(2.5, $this->stockOf($flour));
        $this->actingAs($this->admin)->getJson("/api/ingredients/{$flour->id}/stock-history")
            ->assertOk()->assertJsonPath('data.data.0.reason', 'Opening stock');
    }

    public function test_a_new_ingredient_is_listed_in_either_shop(): void
    {
        foreach (['restaurant', 'supermarket'] as $mode) {
            Setting::set('business_type', $mode);
            $made = $this->createIngredient(['name' => "Salt {$mode}", 'cost_price' => 1]);

            $listed = $this->actingAs($this->admin)->getJson('/api/ingredients?per_page=100')->assertOk()->json('data.data');
            $this->assertContains($made->id, array_column($listed, 'id'), "not listed in {$mode} mode");
        }
    }

    public function test_one_shops_recipe_ingredients_stay_out_of_the_others_list(): void
    {
        Setting::set('business_type', 'restaurant');
        $flour = $this->createIngredient(['name' => 'Flour', 'cost_price' => 0.001]);
        $cheese = $this->createIngredient(['name' => 'Cheese', 'cost_price' => 6]);
        $this->pizza($flour, $cheese);
        $loose = $this->createIngredient(['name' => 'Pepper', 'cost_price' => 1]);

        Setting::set('business_type', 'supermarket');
        $ids = array_column($this->actingAs($this->admin)->getJson('/api/ingredients?per_page=100')->json('data.data'), 'id');
        $this->assertNotContains($flour->id, $ids);
        $this->assertContains($loose->id, $ids);

        Setting::set('business_type', 'restaurant');
        $ids = array_column($this->actingAs($this->admin)->getJson('/api/ingredients?per_page=100')->json('data.data'), 'id');
        $this->assertContains($flour->id, $ids);
    }

    public function test_selling_voiding_and_refunding_move_the_ingredients(): void
    {
        $flour = $this->createIngredient(['name' => 'Flour', 'cost_price' => 0.001, 'initial_quantity' => 1000]);
        $cheese = $this->createIngredient(['name' => 'Cheese', 'cost_price' => 6, 'initial_quantity' => 1]);
        $pizza = $this->pizza($flour, $cheese);

        // Costed from the recipe: 200 × 0.001 + 0.1 × 6
        $this->assertEqualsWithDelta(0.8, (float) $pizza->cost_price, 0.000001);
        // 1000 g flour makes 5, 1 kg cheese makes 10
        $this->assertSame(5.0, $pizza->total_stock);

        $sale = $this->sell($pizza, 2)->assertCreated()->assertJsonPath('data.kds_status', 'new')->json('data');
        $this->assertSame(600.0, $this->stockOf($flour));
        $this->assertEqualsWithDelta(0.8, $this->stockOf($cheese), 0.0001);
        $this->assertSame(3.0, $pizza->fresh()->total_stock);

        $this->actingAs($this->admin)->patchJson("/api/sales/{$sale['id']}/cancel", ['reason' => 'Wrong order'])->assertOk();
        $this->assertSame(1000.0, $this->stockOf($flour));

        $sale = $this->sell($pizza, 2)->assertCreated()->json('data');
        $this->actingAs($this->admin)->postJson('/api/refunds', [
            'sale_id' => $sale['id'],
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1, 'restock' => true]],
        ])->assertCreated();

        $this->assertSame(800.0, $this->stockOf($flour));
        $this->assertSame(0, Stock::where('product_id', $pizza->id)->count(), 'a made-to-order item never gets stock of its own');
    }

    public function test_it_cannot_be_sold_past_its_ingredients(): void
    {
        $flour = $this->createIngredient(['name' => 'Flour', 'cost_price' => 0.001, 'initial_quantity' => 300]);
        $cheese = $this->createIngredient(['name' => 'Cheese', 'cost_price' => 6, 'initial_quantity' => 1]);
        $pizza = $this->pizza($flour, $cheese);

        $this->sell($pizza, 2)->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'not enough Flour'));
        $this->assertSame(300.0, $this->stockOf($flour));
        $this->assertSame(0, Sale::whereHas('items', fn ($q) => $q->where('product_id', $pizza->id))->count());
    }

    public function test_past_zero_when_allowed_the_shortfall_shows(): void
    {
        Setting::set('block_negative_stock', 'false');
        $flour = $this->createIngredient(['name' => 'Flour', 'cost_price' => 0.001]);
        $cheese = $this->createIngredient(['name' => 'Cheese', 'cost_price' => 6, 'initial_quantity' => 1]);
        $pizza = $this->pizza($flour, $cheese);

        $this->sell($pizza, 1)->assertCreated();
        $this->assertSame(-200.0, $this->stockOf($flour));
    }

    public function test_only_its_own_branchs_ingredients_count_as_available(): void
    {
        $other = Branch::create(['name' => 'Town', 'code' => 'TOWN', 'currency' => 'USD', 'is_active' => true]);
        $townWarehouse = Warehouse::create(['name' => 'Town WH', 'code' => 'WH-TOWN', 'branch_id' => $other->id, 'is_active' => true, 'is_default' => true]);

        $flour = $this->createIngredient(['name' => 'Flour', 'cost_price' => 0.001, 'initial_quantity' => 400]);
        $cheese = $this->createIngredient(['name' => 'Cheese', 'cost_price' => 6, 'initial_quantity' => 1]);
        $pizza = $this->pizza($flour, $cheese);
        IngredientStock::create(['ingredient_id' => $flour->id, 'warehouse_id' => $townWarehouse->id, 'quantity' => 5000]);

        $this->assertSame(2.0, $pizza->fresh()->total_stock);
    }
}
