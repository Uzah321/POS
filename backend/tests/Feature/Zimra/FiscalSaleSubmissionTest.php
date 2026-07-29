<?php

namespace Tests\Feature\Zimra;

use App\Models\Branch;
use App\Models\FiscalDevice;
use App\Models\FiscalReceipt;
use App\Models\FiscalTaxMapping;
use App\Models\Product;
use App\Models\Register;
use App\Models\Setting;
use App\Models\TaxRate;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Zimra\ZimraCryptoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Exercises the actual HTTP checkout flow (POST /api/sales) end-to-end
 * against a faked ZIMRA endpoint, verifying the core promises this
 * integration makes: the sale always completes regardless of ZIMRA's
 * availability, receipt numbering never skips or resets across sales, and a
 * successfully-submitted receipt comes back with ZIMRA's identifiers.
 */
class FiscalSaleSubmissionTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private Warehouse $warehouse;
    private Register $register;
    private FiscalDevice $device;
    private Product $product;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $this->warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH1', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->register = Register::create(['branch_id' => $this->branch->id, 'name' => 'Till 1', 'is_active' => true]);

        $taxRate = TaxRate::create(['name' => 'VAT', 'rate' => 15, 'is_default' => true, 'is_active' => true]);
        $this->product = Product::create([
            'name' => 'Widget', 'slug' => 'widget', 'sku' => 'WID-1', 'branch_id' => $this->branch->id,
            'tax_rate_id' => $taxRate->id, 'cost_price' => 5, 'selling_price' => 11.50,
            'is_active' => true, 'is_taxable' => true, 'track_stock' => false,
        ]);

        Setting::set('tax_enabled', true);

        $keyPair = (new ZimraCryptoService())->generateKeyPair('ecc');
        $this->device = FiscalDevice::create([
            'register_id' => $this->register->id,
            'device_id' => 321,
            'device_serial_no' => 'SN0001',
            'key_algorithm' => 'ecc',
            'private_key' => $keyPair['private_key'],
            'certificate' => "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
            'environment' => 'test',
            'operating_mode' => 'online',
            'qr_url' => 'https://invoice.zimra.co.zw',
            'next_receipt_global_no' => 1,
            'status' => 'registered',
        ]);
        FiscalTaxMapping::create([
            'fiscal_device_id' => $this->device->id,
            'zimra_tax_id' => 1,
            'tax_percent' => 15,
            'tax_name' => 'VAT 15%',
            'valid_from' => now()->subYear(),
            'local_tax_rate_id' => $taxRate->id,
        ]);

        $this->user = User::factory()->create(['branch_id' => $this->branch->id]);
    }

    private function saleUrl(): string
    {
        return '/api/sales';
    }

    private function fakeSuccessfulZimra(): void
    {
        Http::fake([
            '*/openDay' => Http::response(['operationID' => 'op-open', 'fiscalDayNo' => 1], 200),
            '*/submitReceipt' => Http::sequence()
                ->push(['operationID' => 'op-1', 'receiptID' => 1001, 'receiptServerSignature' => ['hash' => 'h1', 'signature' => 's1', 'certificateThumbprint' => 't1']], 200)
                ->push(['operationID' => 'op-2', 'receiptID' => 1002, 'receiptServerSignature' => ['hash' => 'h2', 'signature' => 's2', 'certificateThumbprint' => 't2']], 200),
        ]);
    }

    private function payload(): array
    {
        return [
            'branch_id' => $this->branch->id,
            'warehouse_id' => $this->warehouse->id,
            'register_id' => $this->register->id,
            'items' => [
                ['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 11.50],
            ],
            'payments' => [
                ['method' => 'cash', 'amount' => 11.50],
            ],
        ];
    }

    public function test_sale_submits_a_fiscal_receipt_to_zimra(): void
    {
        $this->fakeSuccessfulZimra();

        $response = $this->actingAs($this->user, 'sanctum')->postJson($this->saleUrl(), $this->payload());

        $response->assertStatus(201);
        $response->assertJsonPath('data.fiscal_receipt.status', 'submitted');

        $this->assertDatabaseCount('fiscal_receipts', 1);
        $receipt = FiscalReceipt::first();
        $this->assertSame('submitted', $receipt->status);
        $this->assertSame(1, $receipt->receipt_counter);
        $this->assertSame(1, $receipt->receipt_global_no);
        $this->assertSame(1001, $receipt->zimra_receipt_id);
        $this->assertNotNull($receipt->qr_code_url);
        $this->assertNull($receipt->previous_receipt_hash);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/openDay'));
        Http::assertSent(fn ($request) => str_contains($request->url(), '/submitReceipt'));
    }

    public function test_second_sale_chains_from_the_first_receipts_hash_without_skipping_numbers(): void
    {
        $this->fakeSuccessfulZimra();

        $this->actingAs($this->user, 'sanctum')->postJson($this->saleUrl(), $this->payload())->assertStatus(201);
        $this->actingAs($this->user, 'sanctum')->postJson($this->saleUrl(), $this->payload())->assertStatus(201);

        $receipts = FiscalReceipt::orderBy('receipt_global_no')->get();
        $this->assertCount(2, $receipts);

        $this->assertSame(1, $receipts[0]->receipt_counter);
        $this->assertSame(1, $receipts[0]->receipt_global_no);
        $this->assertNull($receipts[0]->previous_receipt_hash);

        $this->assertSame(2, $receipts[1]->receipt_counter);
        $this->assertSame(2, $receipts[1]->receipt_global_no);
        $this->assertSame($receipts[0]->device_hash, $receipts[1]->previous_receipt_hash);

        $this->assertSame(3, $this->device->fresh()->next_receipt_global_no);
    }

    public function test_sale_still_completes_when_zimra_is_unreachable(): void
    {
        Http::fake(['*' => Http::response(['title' => 'server error'], 500)]);

        $response = $this->actingAs($this->user, 'sanctum')->postJson($this->saleUrl(), $this->payload());

        $response->assertStatus(201);
        $response->assertJsonPath('data.status', 'completed');
        $response->assertJsonPath('data.fiscal_receipt.status', 'failed');

        $receipt = FiscalReceipt::first();
        $this->assertSame('failed', $receipt->status);
        $this->assertNotNull($receipt->last_error);
        // The reserved number must still be sitting there, unsubmitted — never
        // reused by a later sale — so a retry can resend this exact receipt.
        $this->assertSame(1, $receipt->receipt_global_no);
        $this->assertSame(2, $this->device->fresh()->next_receipt_global_no);
    }

    public function test_sale_taxes_a_product_with_no_explicit_tax_rate_id_via_the_global_rate(): void
    {
        // Most products never get an explicit tax_rate_id in Core — they just
        // inherit the store-wide rate (see SaleController::store()) — so the
        // ZIMRA tax mapping must still be found by matching percentages, not
        // by requiring every product to be tagged with a tax_rate_id.
        $untaggedProduct = Product::create([
            'name' => 'Gadget', 'slug' => 'gadget', 'sku' => 'GAD-1', 'branch_id' => $this->branch->id,
            'tax_rate_id' => null, 'cost_price' => 5, 'selling_price' => 11.50,
            'is_active' => true, 'is_taxable' => true, 'track_stock' => false,
        ]);
        Setting::set('tax_rate', 15);

        $this->fakeSuccessfulZimra();

        $payload = $this->payload();
        $payload['items'] = [['product_id' => $untaggedProduct->id, 'quantity' => 1, 'unit_price' => 11.50]];

        $response = $this->actingAs($this->user, 'sanctum')->postJson($this->saleUrl(), $payload);

        $response->assertStatus(201);
        $response->assertJsonPath('data.fiscal_receipt.status', 'submitted');

        $receipt = FiscalReceipt::first();
        $taxes = $receipt->payload['receiptTaxes'];
        $this->assertCount(1, $taxes);
        $this->assertSame(1, $taxes[0]['taxID']);
        $this->assertEqualsWithDelta(15.0, $taxes[0]['taxPercent'], 0.001);
    }

    public function test_sale_without_a_register_is_unaffected_by_fiscalisation(): void
    {
        $payload = $this->payload();
        unset($payload['register_id']);

        $response = $this->actingAs($this->user, 'sanctum')->postJson($this->saleUrl(), $payload);

        $response->assertStatus(201);
        $response->assertJsonPath('data.fiscal_receipt', null);
        $this->assertDatabaseCount('fiscal_receipts', 0);
    }
}
