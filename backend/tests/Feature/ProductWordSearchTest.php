<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * A product search matches every word typed, in any order, in the product's
 * name — a number only as a whole number (a uniform size) — or the whole
 * search as the SKU / barcode. Shaped on a uniform shop's catalogue, where
 * SKUs and barcodes are short numbers that must not match a typed size.
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
        $this->product('MINDA BLOUSE 32', ['sku' => '1716', 'barcode' => '208-']);
        $this->product('MINDA BLOUSE 132', ['sku' => '1717', 'barcode' => '209-']);
        $this->product('SHASHANE SKY BLUE SHIRT 30', ['sku' => '2329', 'barcode' => '710-']);
        $this->product('HALF JERSEY BLACK/SKY 34', ['sku' => '449', 'barcode' => '33-32']);
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

    private function search(string $term): array
    {
        return $this->names('/api/products?search=' . urlencode($term));
    }

    public function test_words_match_the_name_in_any_order(): void
    {
        $this->assertSame(['Burger - Chicken'], $this->search('chicken burger'));
        $this->assertSame(['Coke Zero 500ml'], $this->search('coke 500ml'));
        $this->assertSame(['Burger - Chicken', 'Chicken Wings'], $this->search('chicken'));
    }

    public function test_a_size_matches_only_that_size(): void
    {
        $this->assertSame(['MINDA BLOUSE 32'], $this->search('blouse 32'));
        $this->assertSame(['MINDA BLOUSE 32'], $this->search('32'));
        // SKU 2329 and barcode 33-32 contain "32", but neither is a size 32 shirt.
        $this->assertSame([], $this->search('shirt 32'));
        $this->assertSame(['SHASHANE SKY BLUE SHIRT 30'], $this->search('shirt 30'));
    }

    public function test_a_sku_or_barcode_finds_its_product(): void
    {
        $this->assertSame(['SHASHANE SKY BLUE SHIRT 30'], $this->search('2329'));
        $this->assertSame(['HALF JERSEY BLACK/SKY 34'], $this->search('33-32'));
        $this->assertSame(['Coke 330ml'], $this->search('5449000000996'));
        // From 4 characters, the start of a code is enough.
        $this->assertSame(['Coke 330ml', 'Coke Zero 500ml'], $this->search('5449'));
    }

    public function test_the_other_product_searches_match_the_same_way(): void
    {
        $this->assertSame(['MINDA BLOUSE 32'], $this->names('/api/products/search?q=' . urlencode('blouse 32')));
        $this->assertSame(['MINDA BLOUSE 32'], $this->names('/api/inventory/stock-levels?search=' . urlencode('blouse 32')));
        $this->assertSame(['Coke 330ml'], $this->names('/api/products/search?q=5449000000996'));
    }

    public function test_an_empty_quick_search_lists_everything(): void
    {
        $this->assertCount(8, $this->names('/api/products/search?q='));
    }
}
