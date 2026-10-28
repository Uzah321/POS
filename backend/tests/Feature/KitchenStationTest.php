<?php

namespace Tests\Feature;

use App\Models\KitchenStation;
use App\Models\Product;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * Each product names the kitchen station (Grill, Bar, …) its order ticket
 * prints at. A manager keeps the list in Hardware; every till reads it to
 * route tickets. Products with no station go to the default one.
 */
class KitchenStationTest extends TestCase
{
    use RefreshDatabase;

    private User $manager;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        Setting::set('business_type', 'restaurant');
        $role = Role::firstOrCreate(['name' => 'manager', 'guard_name' => 'web']);
        $role->givePermissionTo(Permission::firstOrCreate(['name' => 'manage_settings', 'guard_name' => 'web']));
        $this->manager = $this->user('Manager');
        $this->manager->assignRole($role);
        $this->cashier = $this->user('Cashier');
    }

    private function user(string $name): User
    {
        return User::create(['name' => $name, 'username' => strtolower($name) . uniqid(), 'password' => bcrypt('secret1'), 'is_active' => true]);
    }

    private function station(string $name, bool $default = false): int
    {
        return $this->actingAs($this->manager)
            ->postJson('/api/kitchen-stations', ['name' => $name, 'is_default' => $default])
            ->assertCreated()->json('data.id');
    }

    private function product(array $attributes = []): array
    {
        return $this->actingAs($this->manager)->postJson('/api/products', array_merge([
            'name' => 'Burger ' . uniqid(), 'sku' => 'B' . uniqid(), 'cost_price' => 2, 'selling_price' => 5,
        ], $attributes))->assertCreated()->json('data');
    }

    public function test_a_product_keeps_its_station_and_can_change_or_clear_it(): void
    {
        $grill = $this->station('Grill');
        $bar = $this->station('Bar');

        $product = $this->product(['kitchen_station_id' => $grill]);
        $this->assertSame($grill, $product['kitchen_station_id']);

        // An edit that doesn't touch the station leaves it alone.
        $this->putJson("/api/products/{$product['id']}", ['selling_price' => 6])->assertOk();
        $this->assertSame($grill, Product::find($product['id'])->kitchen_station_id);

        $this->putJson("/api/products/{$product['id']}", ['kitchen_station_id' => $bar])->assertOk();
        $this->assertSame($bar, Product::find($product['id'])->kitchen_station_id);

        $this->putJson("/api/products/{$product['id']}", ['kitchen_station_id' => null])->assertOk();
        $this->assertNull(Product::find($product['id'])->kitchen_station_id);

        // The tills read it straight off the product list.
        $listed = collect($this->getJson('/api/products?per_page=50')->assertOk()->json('data.data'))->firstWhere('id', $product['id']);
        $this->assertArrayHasKey('kitchen_station_id', $listed);
    }

    public function test_an_unknown_station_is_refused(): void
    {
        $this->actingAs($this->manager)->postJson('/api/products', [
            'name' => 'Pizza', 'sku' => 'PZ1', 'cost_price' => 2, 'selling_price' => 5, 'kitchen_station_id' => 999,
        ])->assertUnprocessable()->assertJsonValidationErrors('kitchen_station_id');
    }

    public function test_only_one_station_is_the_default(): void
    {
        $main = $this->station('Main Kitchen', default: true);
        $bar = $this->station('Bar', default: true);

        $this->assertFalse(KitchenStation::find($main)->is_default);
        $this->assertTrue(KitchenStation::find($bar)->is_default);

        $this->putJson("/api/kitchen-stations/{$main}", ['is_default' => true])->assertOk();
        $this->assertSame([$main], KitchenStation::where('is_default', true)->pluck('id')->all());
    }

    public function test_removing_a_station_sends_its_products_to_the_default(): void
    {
        $pizza = $this->station('Pizza');
        $product = $this->product(['kitchen_station_id' => $pizza]);

        $this->getJson('/api/kitchen-stations')->assertOk()->assertJsonPath('data.0.products_count', 1);
        $this->deleteJson("/api/kitchen-stations/{$pizza}")->assertOk();

        $this->assertNull(Product::find($product['id'])->kitchen_station_id);
    }

    public function test_station_names_are_unique(): void
    {
        $this->station('Grill');
        $this->actingAs($this->manager)->postJson('/api/kitchen-stations', ['name' => 'Grill'])
            ->assertUnprocessable()->assertJsonValidationErrors('name');
    }

    public function test_a_cashier_reads_the_list_but_cannot_change_it(): void
    {
        $grill = $this->station('Grill', default: true);

        $this->actingAs($this->cashier)->getJson('/api/kitchen-stations')->assertOk()
            ->assertJsonPath('data.0.name', 'Grill')->assertJsonPath('data.0.is_default', true);
        $this->postJson('/api/kitchen-stations', ['name' => 'Bar'])->assertForbidden();
        $this->putJson("/api/kitchen-stations/{$grill}", ['name' => 'Bar'])->assertForbidden();
        $this->deleteJson("/api/kitchen-stations/{$grill}")->assertForbidden();
    }
}
