<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * A scale label scanned into a product search finds its product by the PLU
 * code inside it (Settings → Barcodes layout), as does a typed PLU code.
 * The counter scale's labels: "20", a 3-digit PLU from digit 4, a 5-digit
 * weight in grams from digit 8 — e.g. 20 0 123 7 01250 4.
 */
class ScaleBarcodeSearchTest extends TestCase
{
    use RefreshDatabase;

    private const LABEL = '2001237012504';

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

        $this->product('Beef Mince', ['plu_code' => '123', 'sold_by_weight' => true]);
        $this->product('Pork Chops', ['plu_code' => '0124', 'sold_by_weight' => true]);
        $this->product('Coke 330ml', ['barcode' => '6009876543210']);
    }

    private function product(string $name, array $attributes = []): Product
    {
        return Product::create(array_merge([
            'name' => $name, 'slug' => \Illuminate\Support\Str::slug($name) . uniqid(), 'sku' => strtoupper(substr($name, 0, 4)) . uniqid(),
            'selling_price' => 10, 'cost_price' => 5, 'business_type' => 'supermarket', 'is_active' => true,
        ], $attributes));
    }

    private function enableWeightLabels(array $layout = []): void
    {
        Setting::set('barcode_weight_enabled', 'true');
        foreach ($layout as $key => $value) {
            Setting::set("barcode_weight_{$key}", $value);
        }
    }

    private function names(string $url): array
    {
        $json = $this->actingAs($this->user)->getJson($url)->assertOk()->json('data');
        return collect($json['data'] ?? $json)->pluck('name')->sort()->values()->all();
    }

    public function test_a_scanned_label_finds_its_product_with_the_layout_from_settings(): void
    {
        $this->enableWeightLabels(['prefix' => '20', 'code_position' => '4', 'code_length' => '3', 'qty_position' => '8', 'qty_length' => '5']);

        $this->assertSame(['Beef Mince'], $this->names('/api/products?search=' . self::LABEL));
        $this->assertSame(['Beef Mince'], $this->names('/api/products/search?q=' . self::LABEL));
        $this->assertSame(['Beef Mince'], $this->names('/api/inventory/stock-levels?search=' . self::LABEL));
    }

    public function test_blank_layout_fields_mean_the_values_shown_in_settings(): void
    {
        $this->enableWeightLabels();

        $this->assertSame(['Beef Mince'], $this->names('/api/products?search=' . self::LABEL));
    }

    public function test_labels_work_before_settings_are_ever_saved(): void
    {
        $this->assertSame(['Beef Mince'], $this->names('/api/products?search=' . self::LABEL));
        $this->assertSame(['Beef Mince'], $this->names('/api/products/search?q=' . self::LABEL));
    }

    public function test_labels_are_left_alone_while_weight_barcodes_are_switched_off(): void
    {
        Setting::set('barcode_weight_enabled', 'false');

        $this->assertSame([], $this->names('/api/products?search=' . self::LABEL));
    }

    public function test_a_label_finds_the_item_code_kept_as_a_barcode(): void
    {
        $this->product('Boerewors', ['barcode' => '108', 'sold_by_weight' => true]);

        $this->assertSame(['Boerewors'], $this->names('/api/products?search=2001085010869'));
    }

    public function test_the_migration_turns_weight_labels_on_unless_price_labels_share_the_flag(): void
    {
        $migration = require database_path('migrations/2026_10_19_000002_turn_on_scale_weight_labels.php');

        Setting::set('barcode_weight_enabled', 'false');
        $migration->up();
        $this->assertSame('true', Setting::get('barcode_weight_enabled'));

        Setting::set('barcode_weight_enabled', 'false');
        Setting::set('barcode_price_enabled', 'true');
        Setting::set('barcode_price_prefix', '2');
        $migration->up();
        $this->assertSame('false', Setting::get('barcode_weight_enabled'));

        Setting::set('barcode_price_prefix', '02');
        $migration->up();
        $this->assertSame('true', Setting::get('barcode_weight_enabled'));
    }

    public function test_a_typed_plu_code_finds_its_product_whatever_the_leading_zeros(): void
    {
        $this->assertSame(['Pork Chops'], $this->names('/api/products?search=124'));
        $this->assertSame(['Beef Mince'], $this->names('/api/products?search=00123'));
    }

    public function test_plain_searches_still_work(): void
    {
        $this->enableWeightLabels();

        $this->assertSame(['Coke 330ml'], $this->names('/api/products?search=6009876543210'));
        $this->assertSame(['Beef Mince'], $this->names('/api/products?search=beef'));
    }
}
