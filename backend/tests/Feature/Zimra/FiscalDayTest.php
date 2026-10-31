<?php

namespace Tests\Feature\Zimra;

use App\Models\Branch;
use App\Models\EndOfDay;
use App\Models\FiscalDay;
use App\Models\FiscalDevice;
use App\Models\Product;
use App\Models\Register;
use App\Models\User;
use App\Services\Zimra\ZimraCryptoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

/**
 * A till registered with ZIMRA itself: Day End closes its fiscal day, the
 * first order after opens the next, and a close Day End didn't get done is
 * made by the tills' sync poll.
 */
class FiscalDayTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private FiscalDevice $device;
    private Product $product;
    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();

        $this->branch = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $register = Register::create(['branch_id' => $this->branch->id, 'name' => 'Till 1', 'is_active' => true]);
        $this->product = Product::create([
            'name' => 'Widget', 'slug' => 'widget', 'sku' => 'WID-1', 'branch_id' => $this->branch->id,
            'cost_price' => 5, 'selling_price' => 10, 'is_active' => true, 'track_stock' => false,
        ]);

        $this->device = FiscalDevice::create([
            'register_id' => $register->id,
            'device_id' => 321,
            'device_serial_no' => 'SN0001',
            'key_algorithm' => 'ecc',
            'private_key' => (new ZimraCryptoService())->generateKeyPair('ecc')['private_key'],
            'certificate' => "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
            'environment' => 'test',
            'operating_mode' => 'online',
            'next_receipt_global_no' => 1,
            'status' => 'registered',
        ]);

        Permission::firstOrCreate(['name' => 'manage_day_end', 'guard_name' => 'web']);
        $this->manager = User::factory()->create(['branch_id' => $this->branch->id]);
        $this->manager->givePermissionTo('manage_day_end');
    }

    private function openDay(int $no): FiscalDay
    {
        return FiscalDay::create([
            'fiscal_device_id' => $this->device->id, 'fiscal_day_no' => $no, 'status' => 'opened',
            'opened_at' => now()->subHours(8), 'opened_remotely_at' => now()->subHours(8), 'counters' => [],
        ]);
    }

    private function holdAnOrder(): void
    {
        $this->actingAs($this->manager, 'sanctum')->postJson('/api/sales/hold', [
            'branch_id' => $this->branch->id, 'cart_data' => ['items' => [['product_id' => $this->product->id, 'quantity' => 1]]],
        ])->assertStatus(201);
    }

    private function zimraCalls(string $endpoint): int
    {
        return Http::recorded(fn (Request $r) => str_ends_with($r->url(), "/{$endpoint}"))->count();
    }

    public function test_day_end_closes_the_tills_fiscal_day(): void
    {
        $day = $this->openDay(1);
        Http::fake([
            '*/closeDay' => Http::response(['operationID' => 'op-close'], 200),
            '*/getStatus' => Http::response(['fiscalDayStatus' => 'FiscalDayClosed', 'lastFiscalDayNo' => 1], 200),
        ]);

        $this->actingAs($this->manager, 'sanctum')->postJson('/api/end-of-day', [
            'report_date' => now()->toDateString(), 'opening_cash' => 0, 'actual_cash' => 0,
        ])->assertStatus(201)->assertJsonPath('data.fiscal_days.0.provider', 'zimra');

        $this->assertSame('closed', $day->fresh()->status);
        $this->assertSame(1, $this->zimraCalls('closeDay'));
    }

    public function test_the_first_order_after_day_end_opens_the_next_fiscal_day(): void
    {
        $this->openDay(1)->update(['status' => 'closed', 'closed_at' => now()->subHour()]);
        Http::fake(['*/openDay' => Http::response(['operationID' => 'op-open', 'fiscalDayNo' => 2], 200)]);

        $this->holdAnOrder();
        $this->holdAnOrder();

        $day = $this->device->fresh()->currentFiscalDay();
        $this->assertSame(2, $day->fiscal_day_no);
        $this->assertNotNull($day->opened_remotely_at);
        $this->assertSame(1, $this->zimraCalls('openDay'));
    }

    public function test_a_day_still_open_after_day_end_is_closed_by_the_sync_and_not_carried_on(): void
    {
        // The Day End's own close never ran.
        $day = $this->openDay(1);
        EndOfDay::create(['branch_id' => $this->branch->id, 'user_id' => $this->manager->id, 'report_date' => now()->toDateString(), 'status' => 'closed']);
        Http::fake([
            '*/closeDay' => Http::response(['operationID' => 'op-close'], 200),
            '*/getStatus' => Http::sequence()
                ->push(['fiscalDayStatus' => 'FiscalDayCloseInitiated'], 200)
                ->push(['fiscalDayStatus' => 'FiscalDayClosed'], 200),
        ]);

        // An order doesn't carry on with it, nor open another over it.
        $this->holdAnOrder();
        $this->assertSame(0, $this->zimraCalls('openDay'));
        $summary = $this->actingAs($this->manager, 'sanctum')->getJson('/api/end-of-day/summary')->json('data.fiscal_days');
        $this->assertSame('closing', $summary[0]['status']);

        $this->actingAs($this->manager, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id])->assertOk();
        $this->assertSame('close_initiated', $day->fresh()->status);

        // ZIMRA closes days in its own time: the next sync asks how it went.
        $this->actingAs($this->manager, 'sanctum')->postJson('/api/fiscal/sync', ['branch_id' => $this->branch->id])->assertOk();
        $this->assertSame('closed', $day->fresh()->status);
        $this->assertSame(1, $this->zimraCalls('closeDay'));
    }
}
