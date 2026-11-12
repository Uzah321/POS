<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * A product search matches every word typed, in any order, anywhere in the
 * name, SKU or barcode — not the whole phrase as typed.
 */
class ProductWordSearchTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        Setting::set('business_type', 'supermarket');
        $this->user = User::create([
            'name' => 'Admin', 'username' => 'admin' . uniqid(), 'password' => bcrypt('secret1'), 'is_active' => true,
        ]);
        Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web']);
        $this->user->assignRole('admin');

        $this->product('Burger - Chicken', ['sku' => 'BRG-CHK']);
        $this->product('Chicken Wings', ['sku' => 'WNG-6']);
        $this->product('Coke Zero 500ml', ['barcode' => '5449000131805']);
        $this->product('Coke 330ml', ['barcode' => '5449000000996']);
    }

    private function product(string $name, array $attributes = []): Product
    {
        return Product::create(array_merge([
            'name' => $name, 'slug' => \Illuminate\Support\Str::slug($name) . uniqid(), 'sku' => strtoupper(substr($name, 0, 4)) . uniqid(),
            'selling_price' => 10, 'cost_price' => 5, 'business_type' => 'supermarket', 'is_active' => true,
        ], $attributes));
    }

    private function names(string $url): array
    {
        $json = $this->actingAs($this->user)->getJson($url)->assertOk()->json('data');
        return collect($json['data'] ?? $json)->pluck('name')->sort()->values()->all();
    }

    public function test_words_match_in_any_order(): void
    {
        $this->assertSame(['Burger - Chicken'], $this->names('/api/products?search=' . urlencode('chicken burger')));
        $this->assertSame(['Coke Zero 500ml'], $this->names('/api/products?search=' . urlencode('coke 500')));
        $this->assertSame(['Burger - Chicken', 'Chicken Wings'], $this->names('/api/products?search=chicken'));
    }

    public function test_words_can_come_from_the_name_sku_and_barcode_together(): void
    {
        $this->assertSame(['Chicken Wings'], $this->names('/api/products?search=' . urlencode('wings wng')));
        $this->assertSame(['Coke Zero 500ml'], $this->names('/api/products?search=' . urlencode('coke 131805')));
    }

    public function test_the_other_product_searches_match_the_same_way(): void
    {
        $this->assertSame(['Burger - Chicken'], $this->names('/api/products/search?q=' . urlencode('chicken burger')));
        $this->assertSame(['Burger - Chicken'], $this->names('/api/inventory/stock-levels?search=' . urlencode('chicken burger')));
    }

    public function test_a_full_barcode_still_finds_its_product(): void
    {
        $this->assertSame(['Coke 330ml'], $this->names('/api/products?search=5449000000996'));
        $this->assertSame(['Coke 330ml'], $this->names('/api/products/search?q=5449000000996'));
    }

    public function test_an_empty_quick_search_lists_everything(): void
    {
        $this->assertCount(4, $this->names('/api/products/search?q='));
    }
}
