<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Sale;
use App\Models\User;
use App\Models\Warehouse;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Sales History with no dates picked shows the day that's still open: the
 * sales since the branch's last Day End, starting again after each one.
 * Picking dates still reaches every sale.
 */
class SalesHistoryDayEndTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Branch $branch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::where('username', 'admin')->firstOrFail();
        $this->branch = Branch::where('code', 'MAIN')->firstOrFail();
    }

    private function sale(?Branch $branch = null): Sale
    {
        $branch ??= $this->branch;
        $warehouse = Warehouse::firstOrCreate(['branch_id' => $branch->id], ['name' => "{$branch->name} WH", 'code' => "WH-{$branch->code}", 'is_default' => true, 'is_active' => true]);
        return Sale::create([
            'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'user_id' => $this->admin->id,
            'status' => 'completed', 'subtotal' => 10, 'total' => 10, 'amount_paid' => 10, 'completed_at' => now(),
        ]);
    }

    private function runDayEnd(): void
    {
        $this->actingAs($this->admin)->postJson('/api/end-of-day', [
            'branch_id' => $this->branch->id, 'report_date' => now()->toDateString(), 'opening_cash' => 0, 'actual_cash' => 0,
        ])->assertSuccessful();
    }

    private function history(string $query): array
    {
        return $this->actingAs($this->admin)->getJson("/api/sales?per_page=500&{$query}")->assertOk()->json();
    }

    public function test_the_list_starts_again_after_each_day_end(): void
    {
        $this->runDayEnd();
        $first = [$this->sale()->id, $this->sale()->id];

        $open = $this->history("since_day_end=1&branch_id={$this->branch->id}");
        $this->assertEqualsCanonicalizing($first, array_column($open['data']['data'], 'id'));
        $this->assertSame(2, $open['summary']['count']);
        $this->assertEquals(20, $open['summary']['total']);
        $this->assertNotNull($open['summary']['day_end_at']);
        $this->assertFalse($open['summary']['each_branch']);

        $this->travel(1)->days();
        $this->runDayEnd();
        $next = $this->sale()->id;

        $open = $this->history("since_day_end=1&branch_id={$this->branch->id}");
        $this->assertSame([$next], array_column($open['data']['data'], 'id'));
        $this->assertEquals(10, $open['summary']['total']);

        // Dates picked: the earlier day's sales are all still there
        $picked = $this->history('date_from=' . now()->subDays(3)->toDateString() . "&branch_id={$this->branch->id}");
        $this->assertEmpty(array_diff([...$first, $next], array_column($picked['data']['data'], 'id')));
    }

    public function test_every_sale_of_the_day_is_on_exactly_one_page(): void
    {
        $this->runDayEnd();
        // All in the same second, as on a busy till or an offline till syncing
        $this->freezeTime();
        $ids = [];
        for ($i = 0; $i < 25; $i++) {
            $ids[] = $this->sale()->id;
        }

        $seen = [];
        for ($page = 1; $page <= 3; $page++) {
            $res = $this->actingAs($this->admin)
                ->getJson("/api/sales?since_day_end=1&branch_id={$this->branch->id}&per_page=10&page={$page}")
                ->assertOk()->json('data');
            $this->assertSame(25, $res['total']);
            $this->assertSame(3, $res['last_page']);
            $seen = [...$seen, ...array_column($res['data'], 'id')];
        }

        $this->assertCount(25, $seen);
        $this->assertEqualsCanonicalizing($ids, $seen);
        $this->assertSame(array_reverse($ids), $seen); // newest first
    }

    public function test_across_branches_each_starts_at_its_own_day_end(): void
    {
        $other = Branch::create(['name' => 'Second Shop', 'code' => 'SEC', 'currency' => 'USD', 'is_active' => true]);
        $this->runDayEnd();
        $main = $this->sale()->id;
        $second = [$this->sale($other)->id, $this->sale($other)->id];

        $open = $this->history('since_day_end=1');
        $rows = collect($open['data']['data']);
        // The main branch's demo sales were before its Day End; the second branch has never run one
        $this->assertSame([$main], $rows->where('branch_id', $this->branch->id)->pluck('id')->values()->all());
        $this->assertEqualsCanonicalizing($second, $rows->where('branch_id', $other->id)->pluck('id')->values()->all());
        $this->assertTrue($open['summary']['each_branch']);

        $this->assertNull($this->history("since_day_end=1&branch_id={$other->id}")['summary']['day_end_at']);
    }
}
