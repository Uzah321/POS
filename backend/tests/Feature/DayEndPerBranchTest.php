<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\EndOfDay;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\User;
use App\Models\Warehouse;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Each branch closes its own day from its own sales: its own summary, its
 * own Day End record, and closing one branch leaves the others open.
 */
class DayEndPerBranchTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Branch $main;
    private Branch $second;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->admin = User::where('username', 'admin')->firstOrFail();
        $this->main = Branch::where('code', 'MAIN')->firstOrFail();
        $this->second = Branch::create(['name' => 'Second Shop', 'code' => 'SEC', 'currency' => 'USD', 'is_active' => true]);
        // Start from a day with no demo sales
        $this->travel(2)->days();
        $this->sell($this->main, 100);
        $this->sell($this->second, 30);
        $this->sell($this->second, 12);
    }

    private function sell(Branch $branch, float $amount): void
    {
        $warehouse = Warehouse::firstOrCreate(['branch_id' => $branch->id], ['name' => "{$branch->name} WH", 'code' => "WH-{$branch->code}", 'is_default' => true, 'is_active' => true]);
        $sale = Sale::create([
            'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'user_id' => $this->admin->id,
            'status' => 'completed', 'subtotal' => $amount, 'total' => $amount, 'amount_paid' => $amount, 'completed_at' => now(),
        ]);
        SalePayment::create(['sale_id' => $sale->id, 'method' => 'cash', 'amount' => $amount]);
    }

    private function manager(Branch $branch): User
    {
        $user = User::create(['name' => 'Manager', 'username' => 'mgr' . uniqid(), 'password' => 'secret123', 'branch_id' => $branch->id, 'is_active' => true]);
        $user->assignRole('manager');
        return $user;
    }

    private function summary(User $as, ?Branch $branch = null): array
    {
        return $this->actingAs($as)->getJson('/api/end-of-day/summary?' . http_build_query(array_filter([
            'date' => now()->toDateString(), 'branch_id' => $branch?->id,
        ])))->assertOk()->json('data');
    }

    private function close(User $as, ?Branch $branch = null)
    {
        return $this->actingAs($as)->postJson('/api/end-of-day', array_filter([
            'branch_id' => $branch?->id, 'report_date' => now()->toDateString(), 'opening_cash' => 0, 'actual_cash' => 0,
        ], fn ($v) => $v !== null));
    }

    public function test_each_branch_summary_counts_only_its_own_sales(): void
    {
        $main = $this->summary($this->admin, $this->main);
        $this->assertEquals(100, $main['total_sales']);
        $this->assertSame('Main Branch', $main['branch']['name']);

        $second = $this->summary($this->admin, $this->second);
        $this->assertEquals(42, $second['total_sales']);
        $this->assertSame(2, $second['total_transactions']);
        $this->assertEquals(42, $second['cash_sales']);
    }

    public function test_an_admin_without_a_branch_choice_gets_one_branch_not_all_combined(): void
    {
        $this->admin->update(['branch_id' => null]);
        $this->assertEquals(100, $this->summary($this->admin)['total_sales']); // the main branch
    }

    public function test_closing_one_branch_leaves_the_others_open(): void
    {
        $this->close($this->admin, $this->second)->assertCreated();

        $this->assertSame(1, EndOfDay::where('branch_id', $this->second->id)->count());
        $this->assertSame(0, EndOfDay::where('branch_id', $this->main->id)->count());
        $this->assertEquals(42, EndOfDay::where('branch_id', $this->second->id)->value('total_sales'));

        // The main branch's history shows nothing closed today, and it can still close its own day
        $history = $this->actingAs($this->admin)->getJson('/api/end-of-day?branch_id=' . $this->main->id)->assertOk()->json('data.data');
        $this->assertSame([], $history);
        $this->close($this->admin, $this->main)->assertCreated();
        $this->assertEquals(100, EndOfDay::where('branch_id', $this->main->id)->value('total_sales'));
    }

    public function test_a_manager_only_sees_and_closes_their_own_branch(): void
    {
        $manager = $this->manager($this->second);

        // Asking for another branch's figures still gets their own
        $this->assertEquals(42, $this->summary($manager, $this->main)['total_sales']);

        $this->close($manager, $this->main)->assertForbidden();
        $this->assertSame(0, EndOfDay::count());

        $this->close($manager)->assertCreated();
        $this->assertSame([$this->second->id], EndOfDay::pluck('branch_id')->all());

        // History: only their own branch's records, whatever they ask for
        $this->close($this->admin, $this->main)->assertCreated();
        $branches = collect($this->actingAs($manager)->getJson('/api/end-of-day?branch_id=' . $this->main->id)->assertOk()->json('data.data'))->pluck('branch_id')->all();
        $this->assertSame([$this->second->id], $branches);
    }
}
