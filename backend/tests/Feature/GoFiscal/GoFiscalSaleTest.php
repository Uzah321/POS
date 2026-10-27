<?php

namespace Tests\Feature\GoFiscal;

use App\Models\Branch;
use App\Models\GoFiscalReceipt;
use App\Models\Product;
use App\Models\Register;
use App\Models\Setting;
use App\Models\TaxRate;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\GoFiscal\GoFiscalClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

/**
 * Checkout through GoFiscal (POST /api/sales on a till linked to one of the
 * engine's devices), against a faked engine: the receipt the engine gets,
 * the code and QR link that come back, and what happens when it doesn't go
 * through — the sale always completes, and the receipt follows later.
 */
class GoFiscalSaleTest extends TestCase
{
    use RefreshDatabase;

    private const RECEIPTS_URL = 'https://api.gofiscal.app/v1/devices/7/receipts';
    private const CONFIG_URL = 'https://api.gofiscal.app/v1/devices/7/config';

    /** The device's taxes as ZIMRA has them: two valid on code B at once. */
    private const TAXES = [
        ['taxID' => 1, 'taxName' => 'Exempt', 'taxPercent' => null, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'C'],
        ['taxID' => 2, 'taxName' => 'Zero rated 0%', 'taxPercent' => 0, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'B'],
        ['taxID' => 514, 'taxName' => 'Non-VAT Withholding Tax', 'taxPercent' => 5, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'B'],
        ['taxID' => 517, 'taxName' => 'Standard rated 15.5%', 'taxPercent' => 15.5, 'validFrom' => null, 'validTill' => null, 'taxCode' => 'A'],
    ];

    /** Whether the engine can hand over the device's config. */
    private bool $configAvailable = true;

    private Branch $branch;
    private Warehouse $warehouse;
    private Register $register;
    private Product $steak;
    private Product $mince;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $this->warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH1', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->register = Register::create(['branch_id' => $this->branch->id, 'name' => 'Till 1', 'is_active' => true, 'gofiscal_device_id' => 7]);

        $vat = TaxRate::create(['name' => 'VAT', 'rate' => 15.5, 'is_default' => true, 'is_active' => true]);
        $this->steak = Product::create([
            'name' => 'Rump Steak', 'slug' => 'rump-steak', 'sku' => 'STK-1', 'hs_code' => '02013000', 'branch_id' => $this->branch->id,
            'tax_rate_id' => $vat->id, 'cost_price' => 5, 'selling_price' => 8.99,
            'is_active' => true, 'is_taxable' => true, 'track_stock' => false,
        ]);
        $this->mince = Product::create([
            'name' => 'Mince', 'slug' => 'mince', 'sku' => 'MNC-1', 'branch_id' => $this->branch->id,
            'cost_price' => 3, 'selling_price' => 6.00,
            'is_active' => true, 'is_taxable' => false, 'track_stock' => false,
        ]);

        Setting::set('tax_enabled', true);
        Setting::set('gofiscal_default_hs_code', '02023000');
        GoFiscalClient::storeKey('gf_live_testkey1234');

        Permission::firstOrCreate(['name' => 'manage_settings', 'guard_name' => 'web']);
        Permission::firstOrCreate(['name' => 'process_refunds', 'guard_name' => 'web']);
        $this->user = User::factory()->create(['branch_id' => $this->branch->id]);
        $this->user->givePermissionTo(['manage_settings', 'process_refunds']);

        Http::fake([self::CONFIG_URL => fn () => $this->configAvailable
            ? Http::response(['stale' => false, 'taxes' => self::TAXES], 200)
            : Http::response(['error' => 'zimra_unavailable', 'detail' => 'ZIMRA could not be reached.'], 503)]);
    }

    private function accepted(array $extra = []): array
    {
        return array_merge([
            'status' => 'accepted', 'deviceId' => 7, 'receiptGlobalNo' => 101, 'receiptCounter' => 5, 'fiscalDayNo' => 12,
            'verificationCode' => 'ABCD-1234-EF56-7890', 'qrUrl' => 'https://fdms.zimra.co.zw/0000000007/21102026/0000000101/ABCD1234EF567890',
        ], $extra);
    }

    /** 1.235 kg of steak at 8.99 and a pack of mince, paid with a $20 note. */
    private function sale(array $overrides = []): array
    {
        return array_merge([
            'branch_id' => $this->branch->id,
            'warehouse_id' => $this->warehouse->id,
            'register_id' => $this->register->id,
            'items' => [
                ['product_id' => $this->steak->id, 'quantity' => 1.235, 'unit_price' => 8.99],
                ['product_id' => $this->mince->id, 'quantity' => 1, 'unit_price' => 6.00],
            ],
            'payments' => [['method' => 'cash', 'amount' => 20]],
        ], $overrides);
    }

    private function sentReceipts(): array
    {
        return Http::recorded(fn (Request $r) => $r->url() === self::RECEIPTS_URL)
            ->map(fn ($pair) => $pair[0]->data()['receipt'])->values()->all();
    }

    public function test_sale_comes_back_with_the_engines_verification_code_and_qr(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::response($this->accepted(), 200)]);

        $response = $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale());

        $response->assertStatus(201)
            ->assertJsonPath('data.fiscal_receipt.provider', 'gofiscal')
            ->assertJsonPath('data.fiscal_receipt.status', 'submitted')
            ->assertJsonPath('data.fiscal_receipt.engine_status', 'accepted')
            ->assertJsonPath('data.fiscal_receipt.receipt_global_no', 101)
            ->assertJsonPath('data.fiscal_receipt.fiscal_day_no', 12)
            ->assertJsonPath('data.fiscal_receipt.qr_data', 'ABCD1234EF567890')
            ->assertJsonPath('data.fiscal_receipt.qr_code_url', $this->accepted()['qrUrl']);
        $this->assertDatabaseCount('fiscal_receipts', 0);

        Http::assertSent(fn (Request $r) => $r->url() === self::RECEIPTS_URL && $r->hasHeader('Authorization', 'Bearer gf_live_testkey1234'));
        [$receipt] = $this->sentReceipts();

        $this->assertSame('FiscalInvoice', $receipt['receiptType']);
        $this->assertSame('USD', $receipt['receiptCurrency']);
        $this->assertSame($response->json('data.reference'), $receipt['invoiceNo']);
        $this->assertTrue($receipt['receiptLinesTaxInclusive']);
        $this->assertArrayNotHasKey('receiptGlobalNo', $receipt);
        $this->assertArrayNotHasKey('receiptDeviceSignature', $receipt);

        [$steak, $mince] = $receipt['receiptLines'];
        $this->assertSame(['Sale', 1, '02013000', 'Rump Steak', 8.99, 1.235, 11.1, 'A'], [
            $steak['receiptLineType'], $steak['receiptLineNo'], $steak['receiptLineHSCode'], $steak['receiptLineName'],
            $steak['receiptLinePrice'], $steak['receiptLineQuantity'], $steak['receiptLineTotal'], $steak['taxCode'],
        ]);
        // No HS code of its own: the default. Not taxable: exempt.
        $this->assertSame('02023000', $mince['receiptLineHSCode']);
        $this->assertSame('C', $mince['taxCode']);

        // The $20 note less the change: what the customer actually paid.
        $this->assertSame([['moneyTypeCode' => 'Cash', 'paymentAmount' => 17.1]], $receipt['receiptPayments']);
    }

    public function test_a_store_that_doesnt_charge_vat_sends_everything_as_non_vat(): void
    {
        Setting::set('tax_enabled', false);
        Http::fake([self::RECEIPTS_URL => Http::response($this->accepted(), 200)]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())->assertStatus(201);

        $lines = $this->sentReceipts()[0]['receiptLines'];
        $this->assertSame(['B', 'B'], array_column($lines, 'taxCode'));
        // B is two taxes on this device: the line says it's the one at the 0% the till charged.
        $this->assertSame([2, 2], array_column($lines, 'taxID'));
    }

    public function test_a_line_carries_a_tax_id_only_when_its_code_is_shared(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::response($this->accepted(), 200)]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())->assertStatus(201);

        // A (15.5%) and C (exempt) are one tax each: the code says it, as before.
        [$steak, $mince] = $this->sentReceipts()[0]['receiptLines'];
        $this->assertArrayNotHasKey('taxID', $steak);
        $this->assertArrayNotHasKey('taxID', $mince);
    }

    public function test_a_receipt_refused_for_want_of_a_tax_id_goes_again_once_the_taxes_are_known(): void
    {
        Setting::set('tax_enabled', false);
        $this->configAvailable = false;
        Http::fake([self::RECEIPTS_URL => Http::sequence()
            ->push(['error' => 'invalid_receipt', 'errors' => ['line 1: more than one tax with code B is valid on 2026-10-27; send the taxID']], 422)
            ->push($this->accepted(), 200)]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())
            ->assertStatus(201)
            ->assertJsonPath('data.fiscal_receipt.status', 'failed');
        $this->assertArrayNotHasKey('taxID', $this->sentReceipts()[0]['receiptLines'][0]);

        // The engine hands the taxes over again: the tills' next sync sends it with them.
        $this->configAvailable = true;
        $this->travel(6)->minutes();
        $this->actingAs($this->user, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id])
            ->assertJsonPath('data.submitted', 1);
        $this->assertSame([2, 2], array_column($this->sentReceipts()[1]['receiptLines'], 'taxID'));
        $this->assertSame('submitted', GoFiscalReceipt::first()->status);
    }

    public function test_a_fiscal_day_can_be_opened_from_settings(): void
    {
        Http::fake(['https://api.gofiscal.app/v1/devices/7/day/open' => Http::sequence()
            ->push(['error' => 'zimra_unavailable', 'detail' => 'ZIMRA could not be reached.'], 503)
            ->push(['status' => 'FiscalDayOpened', 'fiscalDayNo' => 6], 200)]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/fiscal/gofiscal/devices/7/open-day')
            ->assertStatus(422)->assertJsonPath('message', 'ZIMRA could not be reached.');
        $this->actingAs($this->user, 'sanctum')->postJson('/api/fiscal/gofiscal/devices/7/open-day')
            ->assertOk()->assertJsonPath('message', 'Fiscal day opened')->assertJsonPath('data.fiscalDayNo', 6);
    }

    public function test_discounts_go_on_discount_lines_so_the_lines_add_up_to_the_total(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::response($this->accepted(), 200)]);

        $response = $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale([
            'items' => [
                ['product_id' => $this->steak->id, 'quantity' => 2, 'unit_price' => 10, 'discount_type' => 'fixed', 'discount_value' => 1],
                ['product_id' => $this->mince->id, 'quantity' => 1, 'unit_price' => 6.00],
            ],
            'discount_type' => 'fixed', 'discount_value' => 2.5,
            'payments' => [['method' => 'card', 'amount' => 22.5]],
        ]))->assertStatus(201);

        $receipt = $this->sentReceipts()[0];
        $discounts = array_values(array_filter($receipt['receiptLines'], fn ($l) => $l['receiptLineType'] === 'Discount'));
        // Item discount 1.00 on A; the 2.50 off the whole sale split 19 : 6 between A and C.
        $this->assertSame([['A', -2.9], ['C', -0.6]], array_map(fn ($l) => [$l['taxCode'], $l['receiptLineTotal']], $discounts));

        $lineTotal = round(array_sum(array_column($receipt['receiptLines'], 'receiptLineTotal')), 2);
        $this->assertEqualsWithDelta((float) $response->json('data.total'), $lineTotal, 0.001);
        $this->assertSame([['moneyTypeCode' => 'Card', 'paymentAmount' => 22.5]], $receipt['receiptPayments']);
    }

    public function test_a_queued_receipt_prints_with_its_code_like_an_accepted_one(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::response($this->accepted(['status' => 'queued']), 202)]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())
            ->assertStatus(201)
            ->assertJsonPath('data.fiscal_receipt.status', 'submitted')
            ->assertJsonPath('data.fiscal_receipt.engine_status', 'queued')
            ->assertJsonPath('data.fiscal_receipt.qr_data', 'ABCD1234EF567890');
    }

    public function test_sale_completes_when_the_engine_is_down_and_the_receipt_follows_on_the_next_sync(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::sequence()
            ->push(['error' => 'zimra_unavailable', 'detail' => 'ZIMRA could not be reached.'], 503)
            ->push($this->accepted(), 200)]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())
            ->assertStatus(201)
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.fiscal_receipt.status', 'pending')
            ->assertJsonPath('data.fiscal_receipt.error_code', 'zimra_unavailable');

        // Too soon: it backs off between tries.
        $this->actingAs($this->user, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id])
            ->assertJsonPath('data.submitted', 0);

        $this->travel(20)->seconds();
        $this->actingAs($this->user, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id])
            ->assertJsonPath('data.submitted', 1)
            ->assertJsonPath('data.still_pending', 0);

        [$first, $second] = $this->sentReceipts();
        $this->assertSame($first, $second); // the same invoiceNo and payload — the engine dedups it
        $this->assertSame('ABCD1234EF567890', GoFiscalReceipt::first()->qr_data);
    }

    public function test_the_till_can_finish_a_pending_receipt_before_printing(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::sequence()
            ->push(['error' => 'zimra_unavailable'], 503)
            ->push($this->accepted(), 200)]);

        $id = $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())->json('data.fiscal_receipt.id');

        $this->actingAs($this->user, 'sanctum')->postJson("/api/fiscal/gofiscal/receipts/{$id}/submit")
            ->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.qr_code_url', $this->accepted()['qrUrl']);
    }

    public function test_a_refused_receipt_waits_until_it_is_fixed(): void
    {
        Setting::set('gofiscal_default_hs_code', '');
        Http::fake([self::RECEIPTS_URL => Http::sequence()
            ->push(['error' => 'invalid_receipt', 'detail' => 'The receipt has errors.', 'errors' => ['Line 2 needs a receiptLineHSCode.']], 422)
            ->push($this->accepted(), 200)]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())
            ->assertStatus(201)
            ->assertJsonPath('data.fiscal_receipt.status', 'failed')
            ->assertJsonPath('data.fiscal_receipt.last_error', 'Line 2 needs a receiptLineHSCode.');
        $this->assertArrayNotHasKey('receiptLineHSCode', $this->sentReceipts()[0]['receiptLines'][1]);

        // Unchanged, it would only be refused again — so it isn't sent.
        $this->travel(1)->hours();
        $this->actingAs($this->user, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id]);
        $this->assertCount(1, $this->sentReceipts());

        // An HS code for products without one: it goes, and goes through.
        $this->actingAs($this->user, 'sanctum')->putJson('/api/fiscal/gofiscal', ['default_hs_code' => '02023000'])->assertOk();
        $this->actingAs($this->user, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id])
            ->assertJsonPath('data.submitted', 1);
        $this->assertSame('02023000', $this->sentReceipts()[1]['receiptLines'][1]['receiptLineHSCode']);
    }

    public function test_an_expired_fiscal_day_is_closed_and_the_receipt_sent_again(): void
    {
        Http::fake([
            self::RECEIPTS_URL => Http::sequence()
                ->push(['error' => 'fiscal_day_expired', 'detail' => 'The fiscal day is older than 24 hours.'], 409)
                ->push(['error' => 'fiscal_day_expired', 'detail' => 'The fiscal day is older than 24 hours.'], 409)
                ->push($this->accepted(), 200),
            'https://api.gofiscal.app/v1/devices/7/day/close' => Http::response(['status' => 'closed'], 200),
        ]);

        // Checkout can't wait for a day to close: it stays pending...
        $id = $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())
            ->assertJsonPath('data.fiscal_receipt.status', 'pending')
            ->assertJsonPath('data.fiscal_receipt.error_code', 'fiscal_day_expired')
            ->json('data.fiscal_receipt.id');
        Http::assertNotSent(fn (Request $r) => str_ends_with($r->url(), '/day/close'));

        // ...and the till's follow-up closes the day and sends it again.
        $this->actingAs($this->user, 'sanctum')->postJson("/api/fiscal/gofiscal/receipts/{$id}/submit")
            ->assertJsonPath('data.status', 'submitted');
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/v1/devices/7/day/close'));
    }

    public function test_a_refund_sends_a_credit_note_against_the_original_receipt(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::sequence()
            ->push($this->accepted(), 200)
            ->push($this->accepted(['receiptGlobalNo' => 102, 'verificationCode' => '9999-8888-7777-6666']), 200)]);

        $sale = $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())->json('data');
        $steakLine = collect($sale['items'])->firstWhere('product_id', $this->steak->id);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/refunds', [
            'sale_id' => $sale['id'], 'reason' => 'Off-cut',
            'items' => [['sale_item_id' => $steakLine['id'], 'quantity' => 1.235, 'restock' => false]],
        ])->assertStatus(201)
            ->assertJsonPath('data.fiscal_receipt.status', 'submitted')
            ->assertJsonPath('data.fiscal_receipt.qr_data', '9999888877776666');

        $note = $this->sentReceipts()[1];
        $this->assertSame('CreditNote', $note['receiptType']);
        $this->assertSame('Off-cut', $note['receiptNotes']);
        $this->assertSame(['deviceID' => 7, 'receiptGlobalNo' => 101, 'fiscalDayNo' => 12], $note['creditDebitNote']);
        $this->assertSame([-8.99, 1.235, -11.1, 'A'], [
            $note['receiptLines'][0]['receiptLinePrice'], $note['receiptLines'][0]['receiptLineQuantity'],
            $note['receiptLines'][0]['receiptLineTotal'], $note['receiptLines'][0]['taxCode'],
        ]);
        $this->assertSame([['moneyTypeCode' => 'Cash', 'paymentAmount' => -11.1]], $note['receiptPayments']);
    }

    public function test_a_till_not_linked_to_gofiscal_doesnt_use_it(): void
    {
        Http::fake();
        $this->register->update(['gofiscal_device_id' => null]);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())
            ->assertStatus(201)
            ->assertJsonPath('data.fiscal_receipt', null);
        Http::assertNothingSent();
    }

    public function test_a_reprint_carries_the_same_code_and_qr(): void
    {
        Http::fake([self::RECEIPTS_URL => Http::response($this->accepted(), 200)]);
        $saleId = $this->actingAs($this->user, 'sanctum')->postJson('/api/sales', $this->sale())->json('data.id');

        $this->actingAs($this->user, 'sanctum')->getJson("/api/sales/{$saleId}/receipt")
            ->assertJsonPath('data.fiscal_receipt.qr_data', 'ABCD1234EF567890')
            ->assertJsonPath('data.fiscal_receipt.receipt_global_no', 101);
    }

    public function test_a_cashier_can_list_the_tills_to_say_which_one_it_is(): void
    {
        $cashier = User::factory()->create(['branch_id' => $this->branch->id]);

        $this->actingAs($cashier, 'sanctum')->getJson('/api/registers')->assertForbidden();
        $tills = $this->actingAs($cashier, 'sanctum')->getJson('/api/tills')->assertOk()->json('data');

        $this->assertSame([['id' => $this->register->id, 'branch_id' => $this->branch->id, 'name' => 'Till 1', 'code' => null, 'is_active' => true]], $tills);
    }

    public function test_the_api_key_never_reaches_a_browser(): void
    {
        $settings = $this->actingAs($this->user, 'sanctum')->getJson('/api/settings')->assertOk()->json('data');
        $this->assertArrayNotHasKey(GoFiscalClient::KEY_SETTING, $settings);

        $this->actingAs($this->user, 'sanctum')->postJson('/api/settings', [GoFiscalClient::KEY_SETTING => 'overwritten'])->assertOk();
        $this->assertSame('gf_live_testkey1234', GoFiscalClient::storedKey());

        $setup = $this->actingAs($this->user, 'sanctum')->getJson('/api/fiscal/gofiscal')->assertOk();
        $setup->assertJsonPath('data.configured', true)->assertJsonPath('data.key_hint', '1234');
        $this->assertStringNotContainsString('gf_live_testkey1234', $setup->getContent());
    }

    public function test_a_new_key_is_saved_only_once_the_engine_accepts_it(): void
    {
        Http::fake(['https://api.gofiscal.app/v1/me' => Http::sequence()
            ->push(['error' => 'unauthorized', 'detail' => 'Unknown key.'], 401)
            ->push(['companyName' => 'Mazinyane Butchery'], 200)]);

        $this->actingAs($this->user, 'sanctum')->putJson('/api/fiscal/gofiscal', ['api_key' => 'gf_live_wrong'])
            ->assertStatus(422)->assertJsonPath('message', "GoFiscal didn't accept that API key.");
        $this->assertSame('gf_live_testkey1234', GoFiscalClient::storedKey());

        $this->actingAs($this->user, 'sanctum')->putJson('/api/fiscal/gofiscal', ['api_key' => 'gf_live_right5678'])
            ->assertOk()->assertJsonPath('data.company.companyName', 'Mazinyane Butchery');
        $this->assertSame('gf_live_right5678', GoFiscalClient::storedKey());
        Http::assertSent(fn (Request $r) => $r->hasHeader('Authorization', 'Bearer gf_live_right5678'));
    }
}
