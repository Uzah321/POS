<?php

namespace Tests\Feature\GoFiscal;

use App\Models\Branch;
use App\Models\GoFiscalReceipt;
use App\Models\Product;
use App\Models\Register;
use App\Models\Setting;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\GoFiscal\GoFiscalClient;
use App\Services\GoFiscal\GoFiscalService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

/**
 * The fiscal day runs with the business day, against a faked engine: Day End
 * closes it on every till of the branch, without waiting on the engine and
 * retrying until it goes through, and the first order after it opens the
 * next one — the receipts of each day on that day.
 */
class GoFiscalDayTest extends TestCase
{
    use RefreshDatabase;

    private const ENGINE = 'https://api.gofiscal.app/v1/devices';

    private Branch $branch;
    private Warehouse $warehouse;
    private Register $till;
    private Product $steak;
    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $this->warehouse = Warehouse::create(['name' => 'Main WH', 'code' => 'WH1', 'branch_id' => $this->branch->id, 'is_active' => true, 'is_default' => true]);
        $this->till = Register::create(['branch_id' => $this->branch->id, 'name' => 'Till 1', 'is_active' => true, 'gofiscal_device_id' => 7]);
        Register::create(['branch_id' => $this->branch->id, 'name' => 'Till 2', 'is_active' => true, 'gofiscal_device_id' => 8]);

        $other = Branch::create(['name' => 'Other', 'code' => 'OTH', 'currency' => 'USD', 'is_active' => true]);
        Register::create(['branch_id' => $other->id, 'name' => 'Other Till', 'is_active' => true, 'gofiscal_device_id' => 9]);

        $this->steak = Product::create([
            'name' => 'Rump Steak', 'slug' => 'rump-steak', 'sku' => 'STK-1', 'hs_code' => '02013000', 'branch_id' => $this->branch->id,
            'cost_price' => 5, 'selling_price' => 10, 'is_active' => true, 'is_taxable' => false, 'track_stock' => false,
        ]);

        Setting::set('tax_enabled', false);
        GoFiscalClient::storeKey('gf_live_testkey1234');

        Permission::firstOrCreate(['name' => 'manage_day_end', 'guard_name' => 'web']);
        $this->manager = User::factory()->create(['branch_id' => $this->branch->id]);
        $this->manager->givePermissionTo('manage_day_end');
    }

    /** @param array<string, mixed> $stubs URL (under a device) => response */
    private function engine(array $stubs): void
    {
        $fakes = [];
        foreach ($stubs as $path => $response) {
            $fakes[self::ENGINE . "/{$path}"] = $response;
        }
        // The taxes, for a receipt rebuilt before it's sent again.
        $fakes[self::ENGINE . '/*/config'] = Http::response(['taxes' => []], 200);
        Http::fake($fakes);
    }

    private function sent(string $suffix): array
    {
        return Http::recorded(fn (Request $r) => str_ends_with($r->url(), $suffix))->map(fn ($pair) => $pair[0]->url())->values()->all();
    }

    private function dayEnd()
    {
        return $this->actingAs($this->manager, 'sanctum')->postJson('/api/end-of-day', [
            'report_date' => now()->toDateString(), 'opening_cash' => 0, 'actual_cash' => 0,
        ]);
    }

    private function holdAnOrder()
    {
        return $this->actingAs($this->manager, 'sanctum')->postJson('/api/sales/hold', [
            'branch_id' => $this->branch->id, 'cart_data' => ['items' => [['product_id' => $this->steak->id, 'quantity' => 1]]],
        ])->assertStatus(201);
    }

    private function sell()
    {
        return $this->actingAs($this->manager, 'sanctum')->postJson('/api/sales', [
            'branch_id' => $this->branch->id, 'warehouse_id' => $this->warehouse->id, 'register_id' => $this->till->id,
            'items' => [['product_id' => $this->steak->id, 'quantity' => 1, 'unit_price' => 10]],
            'payments' => [['method' => 'cash', 'amount' => 10]],
        ])->assertStatus(201);
    }

    private function accepted(int $globalNo, int $dayNo): array
    {
        return ['status' => 'accepted', 'deviceId' => 7, 'receiptGlobalNo' => $globalNo, 'receiptCounter' => 1, 'fiscalDayNo' => $dayNo, 'verificationCode' => 'ABCD-1234-EF56-7890'];
    }

    private function sync(): void
    {
        $this->actingAs($this->manager, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id])->assertOk();
    }

    private function state(int $device): array
    {
        return app(GoFiscalService::class)->dayState($device);
    }

    public function test_day_end_closes_the_fiscal_day_on_every_till_of_the_branch(): void
    {
        $this->engine([
            '7/day/close' => Http::response(['status' => 'FiscalDayClosed', 'fiscalDayNo' => 12], 200),
            '8/day/close' => Http::response(['status' => 'FiscalDayClosed', 'fiscalDayNo' => 3], 200),
        ]);

        // The till has its answer before the engine is asked anything.
        $this->dayEnd()->assertStatus(201)
            ->assertJsonPath('data.fiscal_days.0.register', 'Till 1')
            ->assertJsonPath('data.fiscal_days.0.status', 'closing')
            ->assertJsonPath('data.fiscal_days.1.status', 'closing');

        $this->assertSame([self::ENGINE . '/7/day/close', self::ENGINE . '/8/day/close'], $this->sent('/day/close'));
        $this->assertFalse($this->state(7)['open']);
        $this->assertNull($this->state(7)['close_owed']);

        $summary = $this->actingAs($this->manager, 'sanctum')->getJson('/api/end-of-day/summary')->assertOk();
        $this->assertSame(['closed', 'closed'], array_column($summary->json('data.fiscal_days'), 'status'));
    }

    public function test_a_close_that_fails_at_day_end_is_retried_by_the_tills_sync_until_it_goes_through(): void
    {
        $this->engine([
            '7/day/close' => Http::sequence()
                ->push(['error' => 'zimra_unavailable', 'detail' => 'ZIMRA could not be reached.'], 503)
                ->push(['status' => 'FiscalDayClosed'], 200),
            '8/day/close' => Http::response(['status' => 'FiscalDayClosed'], 200),
        ]);

        $this->dayEnd()->assertStatus(201);

        $summary = $this->actingAs($this->manager, 'sanctum')->getJson('/api/end-of-day/summary')->json('data.fiscal_days');
        $this->assertSame(['closing', 'closed'], array_column($summary, 'status'));
        $this->assertSame('ZIMRA could not be reached.', $summary[0]['error']);

        // Not straight away: it backs off.
        $this->sync();
        $this->assertCount(1, $this->sent('/7/day/close'));

        $this->travel(31)->seconds();
        $this->sync();
        $this->assertCount(2, $this->sent('/7/day/close'));
        $this->assertNull($this->state(7)['close_owed']);
        $this->assertNull($this->state(7)['error']);
    }

    public function test_the_first_order_after_day_end_opens_the_fiscal_day_and_later_orders_leave_it(): void
    {
        $this->engine([
            '*/day/close' => Http::response(['status' => 'FiscalDayClosed'], 200),
            '*/day/open' => Http::response(['status' => 'FiscalDayOpened', 'fiscalDayNo' => 13], 200),
        ]);
        $this->dayEnd()->assertStatus(201);
        $this->assertSame([], $this->sent('/day/open'));

        $this->holdAnOrder();
        $this->assertSame([self::ENGINE . '/7/day/open', self::ENGINE . '/8/day/open'], $this->sent('/day/open'));
        $this->assertTrue($this->state(7)['open']);

        $this->holdAnOrder();
        $this->assertCount(2, $this->sent('/day/open'));
        $this->assertSame(['open', 'open'], array_column($this->actingAs($this->manager, 'sanctum')->getJson('/api/end-of-day/summary')->json('data.fiscal_days'), 'status'));
    }

    public function test_a_day_the_engine_already_has_open_counts_as_open(): void
    {
        $this->engine(['*/day/open' => Http::response(['error' => 'fiscal_day_already_open', 'detail' => 'Fiscal day 12 is already open.'], 409)]);

        $this->holdAnOrder();
        $this->holdAnOrder();

        $this->assertCount(2, $this->sent('/day/open')); // once per device, not again
        $this->assertTrue($this->state(7)['open']);
        $this->assertNull($this->state(7)['error']);
    }

    public function test_a_sale_rung_up_after_day_end_waits_for_that_day_to_close_and_goes_on_the_next(): void
    {
        $this->engine([
            '7/day/close' => Http::sequence()
                ->push(['error' => 'zimra_unavailable', 'detail' => 'ZIMRA could not be reached.'], 503)
                ->push(['status' => 'FiscalDayClosed'], 200),
            '8/day/close' => Http::response(['status' => 'FiscalDayClosed'], 200),
            '*/day/open' => Http::response(['status' => 'FiscalDayOpened'], 200),
            '7/receipts' => Http::response($this->accepted(201, 13), 200),
        ]);
        $this->dayEnd()->assertStatus(201);
        $this->travel(31)->seconds();

        // Checkout doesn't send it onto the day that's still to close...
        $id = $this->sell()
            ->assertJsonPath('data.fiscal_receipt.status', 'pending')
            ->assertJsonPath('data.fiscal_receipt.error_code', 'fiscal_day_closing')
            ->json('data.fiscal_receipt.id');
        $this->assertSame([], $this->sent('/receipts'));

        // ...the order closes that day, and the till's follow-up sends it on the next.
        $this->actingAs($this->manager, 'sanctum')->postJson("/api/fiscal/gofiscal/receipts/{$id}/submit")
            ->assertOk()->assertJsonPath('data.status', 'submitted')->assertJsonPath('data.fiscal_day_no', 13);

        $calls = Http::recorded(fn (Request $r) => str_contains($r->url(), '/7/') && ! str_ends_with($r->url(), '/config'))
            ->map(fn ($pair) => substr($pair[0]->url(), strlen(self::ENGINE) + 1))->values()->all();
        $this->assertSame(['7/day/close', '7/day/close', '7/receipts'], $calls);
    }

    public function test_receipts_rung_up_before_day_end_go_on_the_day_it_closes(): void
    {
        $this->engine([
            '7/receipts' => Http::sequence()
                ->push(['error' => 'zimra_unavailable', 'detail' => 'ZIMRA could not be reached.'], 503)
                ->push($this->accepted(200, 12), 200),
            '*/day/open' => Http::response(['status' => 'FiscalDayOpened'], 200),
            '*/day/close' => Http::response(['status' => 'FiscalDayClosed'], 200),
        ]);
        $this->sell()->assertJsonPath('data.fiscal_receipt.status', 'pending');
        $this->travel(20)->seconds();

        $this->dayEnd()->assertStatus(201);

        $this->assertSame('submitted', GoFiscalReceipt::first()->status);
        $calls = Http::recorded(fn (Request $r) => str_contains($r->url(), '/7/') && ! str_ends_with($r->url(), '/config'))
            ->map(fn ($pair) => substr($pair[0]->url(), strlen(self::ENGINE) + 1))->values()->all();
        $this->assertSame(['7/receipts', '7/day/open', '7/receipts', '7/day/close'], $calls);
    }

    public function test_a_receipt_refused_because_the_day_isnt_open_opens_it_and_goes_again(): void
    {
        $this->engine([
            '7/receipts' => Http::sequence()
                ->push(['error' => 'fiscal_day_not_open', 'detail' => 'No fiscal day is open.'], 409)
                ->push(['error' => 'fiscal_day_not_open', 'detail' => 'No fiscal day is open.'], 409)
                ->push($this->accepted(301, 14), 200),
            // The open after the sale doesn't get through; the till's follow-up opens it.
            '7/day/open' => Http::sequence()
                ->push(['error' => 'zimra_unavailable', 'detail' => 'ZIMRA could not be reached.'], 503)
                ->push(['status' => 'FiscalDayOpened', 'fiscalDayNo' => 14], 200),
            '8/day/open' => Http::response(['status' => 'FiscalDayOpened'], 200),
        ]);

        $id = $this->sell()->assertJsonPath('data.fiscal_receipt.error_code', 'fiscal_day_not_open')->json('data.fiscal_receipt.id');

        $this->actingAs($this->manager, 'sanctum')->postJson("/api/fiscal/gofiscal/receipts/{$id}/submit")
            ->assertJsonPath('data.status', 'submitted')->assertJsonPath('data.fiscal_day_no', 14);
        $this->assertCount(2, $this->sent('/7/day/open'));
        $this->assertSame([], $this->sent('/day/close'));
        $this->assertTrue($this->state(7)['open']);
    }
}
