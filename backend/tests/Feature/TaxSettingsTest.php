<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\GoFiscal\GoFiscalClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

/**
 * Settings › Enable Tax and Tax Rate, and what reaches ZIMRA. At Mazinyane
 * (Nov 2026) Enable Tax "switched itself off": the Settings page sent every
 * setting it showed, and it sometimes showed them at their defaults or as an
 * older copy had them — so saving anything put tax back off, and every fiscal
 * receipt went to ZIMRA zero-rated. The Tax Rate was 15 while ZIMRA's
 * standard rate is 15.5.
 */
class TaxSettingsTest extends TestCase
{
    use RefreshDatabase;

    private const RECEIPTS_URL = 'https://api.gofiscal.app/v1/devices/7/receipts';
    private const CONFIG_URL = 'https://api.gofiscal.app/v1/devices/7/config';

    /** The device's taxes as ZIMRA has them. */
    private const TAXES = [
        ['taxID' => 2, 'taxName' => 'Zero rate 0%', 'taxPercent' => 0, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'B'],
        ['taxID' => 3, 'taxName' => 'Exempt', 'taxPercent' => null, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'C'],
        ['taxID' => 514, 'taxName' => 'Non-VAT Withholding Tax', 'taxPercent' => 5, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'B'],
        ['taxID' => 515, 'taxName' => 'Standard rated 15.5%', 'taxPercent' => 15.5, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'A'],
    ];

    private Branch $branch;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        Permission::firstOrCreate(['name' => 'manage_settings', 'guard_name' => 'web']);
        $this->admin = User::factory()->create(['branch_id' => $this->branch->id]);
        $this->admin->givePermissionTo('manage_settings');
    }

    /** A till fiscalising through GoFiscal device 7, whose standard rate is 15.5%. */
    private function fiscalise(): Register
    {
        GoFiscalClient::storeKey('gf_live_testkey1234');
        Http::preventStrayRequests();
        Http::fake([
            self::CONFIG_URL => Http::response(['stale' => false, 'taxes' => self::TAXES], 200),
            self::RECEIPTS_URL => Http::response([
                'status' => 'accepted', 'deviceId' => 7, 'receiptGlobalNo' => 101, 'receiptCounter' => 5, 'fiscalDayNo' => 12,
                'verificationCode' => 'ABCD-1234-EF56-7890', 'qrUrl' => 'https://fdms.zimra.co.zw/0000000007/21102026/0000000101/ABCD1234EF567890',
            ], 200),
        ]);

        return Register::create(['branch_id' => $this->branch->id, 'name' => 'Till 1', 'is_active' => true, 'gofiscal_device_id' => 7]);
    }

    private function save(array $settings)
    {
        return $this->actingAs($this->admin)->postJson('/api/settings', $settings);
    }

    public function test_a_save_changes_only_the_settings_it_sends(): void
    {
        $this->save(['tax_enabled' => 'true', 'tax_rate' => '15.5', 'block_negative_stock' => 'false'])->assertOk();

        // The receipt footer changed on its own: tax and the rest stay as they were.
        $this->save(['receipt_footer' => 'Thank you'])->assertOk();

        $this->assertSame('true', Setting::get('tax_enabled'));
        $this->assertSame('15.5', Setting::get('tax_rate'));
        $this->assertSame('false', Setting::get('block_negative_stock'));
        $this->assertSame('Thank you', Setting::get('receipt_footer'));
    }

    public function test_tax_on_and_off_both_save(): void
    {
        $this->save(['tax_enabled' => true, 'tax_rate' => '15.5'])->assertOk();
        $this->assertSame('true', $this->actingAs($this->admin)->getJson('/api/settings/current')->json('data.tax_enabled'));

        $this->save(['tax_enabled' => false])->assertOk();
        $this->assertSame('false', $this->actingAs($this->admin)->getJson('/api/settings/current')->json('data.tax_enabled'));
        $this->assertSame('15.5', Setting::get('tax_rate'));

        $this->save(['tax_enabled' => '1'])->assertOk()->assertJsonPath('data.tax_enabled', 'true');
        $this->assertSame('true', Setting::get('tax_enabled'));
    }

    public function test_the_tax_rate_is_kept_as_entered(): void
    {
        $this->save(['tax_rate' => '15.50'])->assertOk()->assertJsonPath('data.tax_rate', '15.5');
        $this->assertSame('15.5', Setting::get('tax_rate'));

        // A comma for the decimal point, as some phones type it.
        $this->save(['tax_rate' => '15,5'])->assertOk();
        $this->assertSame('15.5', Setting::get('tax_rate'));

        $this->save(['tax_rate' => ''])->assertOk();
        $this->assertSame('', (string) Setting::get('tax_rate'));
    }

    public function test_a_tax_rate_that_isnt_a_percentage_is_refused(): void
    {
        Setting::set('tax_rate', '15.5');

        foreach (['abc', '150', '-1'] as $bad) {
            $this->save(['tax_rate' => $bad, 'receipt_footer' => 'changed'])->assertStatus(422)->assertJsonPath('success', false);
        }
        $this->assertSame('15.5', Setting::get('tax_rate'));
        $this->assertNull(Setting::get('receipt_footer'));
    }

    public function test_settings_kept_by_the_system_are_not_written_from_the_settings_page(): void
    {
        Setting::set('data_reset_at', '2026-11-01T00:00:00+00:00', 'system');
        Setting::set('license_state', '{"status":"active"}', 'license');

        $this->save(['data_reset_at' => '2020-01-01', 'license_state' => '{"status":"old"}', 'company_name' => 'Mazinyane'])->assertOk();

        $this->assertSame('2026-11-01T00:00:00+00:00', Setting::get('data_reset_at'));
        $this->assertSame('{"status":"active"}', Setting::get('license_state'));
        $this->assertSame('Mazinyane', Setting::get('company_name'));
    }

    public function test_the_settings_page_reads_the_saved_settings_and_only_a_manager_can(): void
    {
        $this->save(['tax_enabled' => 'true', 'tax_rate' => '15.5'])->assertOk();

        $this->actingAs($this->admin)->getJson('/api/settings/current')->assertOk()
            ->assertJsonPath('data.tax_enabled', 'true')
            ->assertJsonPath('data.tax_rate', '15.5');

        $cashier = User::factory()->create(['branch_id' => $this->branch->id]);
        $this->actingAs($cashier)->getJson('/api/settings/current')->assertForbidden();
        $this->actingAs($cashier)->postJson('/api/settings', ['tax_enabled' => 'false'])->assertForbidden();
    }

    public function test_without_a_fiscal_device_any_rate_can_be_used(): void
    {
        $this->actingAs($this->admin)->getJson('/api/settings/zimra-vat')->assertOk()->assertJsonPath('data.rates', []);

        $this->save(['tax_enabled' => 'true', 'tax_rate' => '15'])->assertOk();
        $this->assertSame('15', Setting::get('tax_rate'));
    }

    public function test_settings_shows_zimras_standard_rate(): void
    {
        $this->fiscalise();

        $this->actingAs($this->admin)->getJson('/api/settings/zimra-vat')->assertOk()->assertJsonPath('data.rates', [15.5]);
    }

    public function test_with_tax_on_the_rate_must_be_the_one_zimra_records(): void
    {
        $this->fiscalise();
        Setting::set('tax_rate', '15');

        $response = $this->save(['tax_enabled' => 'true'])->assertStatus(422);
        $this->assertStringContainsString('15.5%', $response->json('message'));
        $this->assertNull(Setting::get('tax_enabled'));

        $this->save(['tax_enabled' => 'true', 'tax_rate' => '15'])->assertStatus(422);
        $this->assertSame('15', Setting::get('tax_rate'));

        // Tax on with no rate: VAT of 0, and ZIMRA would record 0%.
        $this->save(['tax_enabled' => 'true', 'tax_rate' => ''])->assertStatus(422);

        $this->save(['tax_enabled' => 'true', 'tax_rate' => '15.5'])->assertOk();
        $this->assertSame('true', Setting::get('tax_enabled'));
        $this->assertSame('15.5', Setting::get('tax_rate'));

        // Now on at ZIMRA's rate, it can't be moved off it.
        $this->save(['tax_rate' => '15'])->assertStatus(422);
        $this->assertSame('15.5', Setting::get('tax_rate'));
    }

    public function test_with_tax_off_the_rate_isnt_checked(): void
    {
        $this->fiscalise();

        $this->save(['tax_enabled' => 'false', 'tax_rate' => '15'])->assertOk();
        $this->assertSame('false', Setting::get('tax_enabled'));
    }

    /**
     * The whole way through: Enable Tax and the rate saved in Settings, a sale,
     * and the fiscal receipt — VAT on the sale at 15.5%, and the line sent
     * under ZIMRA's standard-rated code (15.5%), not zero-rated.
     */
    public function test_the_rate_saved_is_the_rate_the_sale_charges_and_zimra_records(): void
    {
        $register = $this->fiscalise();
        $warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH1', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $beef = Product::create([
            'name' => 'Beef Chuck', 'slug' => 'beef-chuck', 'sku' => 'BEEF-1', 'hs_code' => '02013000', 'branch_id' => $this->branch->id,
            'cost_price' => 5, 'selling_price' => 11.55, 'is_active' => true, 'is_taxable' => true, 'track_stock' => false,
        ]);

        $this->save(['tax_enabled' => 'true', 'tax_rate' => '15.5'])->assertOk();

        $sale = $this->actingAs($this->admin, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->branch->id,
            'warehouse_id' => $warehouse->id,
            'register_id' => $register->id,
            'items' => [['product_id' => $beef->id, 'quantity' => 1, 'unit_price' => 11.55]],
            'payments' => [['method' => 'cash', 'amount' => 11.55]],
        ])->assertStatus(201);

        // 11.55 VAT-inclusive at 15.5%: 10.00 plus 1.55 VAT.
        $this->assertEqualsWithDelta(1.55, (float) Sale::find($sale->json('data.id'))->tax_amount, 0.000001);

        $receipt = Http::recorded(fn (Request $r) => $r->url() === self::RECEIPTS_URL)->first()[0]->data()['receipt'];
        $this->assertSame('A', $receipt['receiptLines'][0]['taxCode']);
        $standard = collect(self::TAXES)->firstWhere('taxCode', 'A');
        $this->assertSame(15.5, $standard['taxPercent']);
    }
}
