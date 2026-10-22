<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/** Setting up restaurant tables (Tables › Manage Tables, and the POS's Add to Tab picker). */
class RestaurantTableTest extends TestCase
{
    use RefreshDatabase;

    private Branch $main;
    private Branch $other;

    protected function setUp(): void
    {
        parent::setUp();

        $this->main = Branch::create(['name' => 'Main', 'code' => 'MAIN', 'currency' => 'USD', 'is_active' => true, 'is_main' => true]);
        $this->other = Branch::create(['name' => 'Town', 'code' => 'TOWN', 'currency' => 'USD', 'is_active' => true]);

        $manageTables = Permission::firstOrCreate(['name' => 'manage_tables', 'guard_name' => 'web']);
        Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web'])->givePermissionTo($manageTables);
        Role::firstOrCreate(['name' => 'manager', 'guard_name' => 'web'])->givePermissionTo($manageTables);
        Role::firstOrCreate(['name' => 'waiter', 'guard_name' => 'web']);
    }

    private function user(string $role, ?Branch $branch): User
    {
        return tap(User::factory()->create(['branch_id' => $branch?->id]))->assignRole($role);
    }

    public function test_staff_without_a_branch_add_tables_to_the_main_branch(): void
    {
        // Admins and managers may be saved without a branch: the screen then sent none.
        $this->actingAs($this->user('admin', null), 'sanctum')
            ->postJson('/api/tables', ['name' => 'Table 1', 'seats' => 4])
            ->assertCreated()
            ->assertJsonPath('data.branch_id', $this->main->id);
    }

    public function test_an_admin_can_add_a_table_to_any_branch_but_a_manager_only_to_their_own(): void
    {
        $this->actingAs($this->user('admin', $this->main), 'sanctum')
            ->postJson('/api/tables', ['branch_id' => $this->other->id, 'name' => 'Patio 1'])
            ->assertCreated()->assertJsonPath('data.branch_id', $this->other->id);

        $this->actingAs($this->user('manager', $this->main), 'sanctum')
            ->postJson('/api/tables', ['branch_id' => $this->other->id, 'name' => 'Patio 2'])
            ->assertCreated()->assertJsonPath('data.branch_id', $this->main->id);
    }

    public function test_seats_default_to_two(): void
    {
        $this->actingAs($this->user('manager', $this->main), 'sanctum')
            ->postJson('/api/tables', ['name' => 'Bar 1', 'seats' => null])
            ->assertCreated()->assertJsonPath('data.seats', 2);
    }

    public function test_a_branch_cant_have_two_tables_with_the_same_name(): void
    {
        $manager = $this->user('manager', $this->main);
        $this->actingAs($manager, 'sanctum')->postJson('/api/tables', ['name' => 'Table 4'])->assertCreated();

        $this->actingAs($manager, 'sanctum')->postJson('/api/tables', ['name' => 'Table 4'])
            ->assertStatus(422)->assertJsonPath('message', 'There is already a table with that name.');

        // Another branch can have its own Table 4.
        $this->actingAs($this->user('manager', $this->other), 'sanctum')
            ->postJson('/api/tables', ['name' => 'Table 4'])->assertCreated();

        // Renaming one onto another's name is refused too; keeping its own name isn't.
        $table5 = RestaurantTable::create(['branch_id' => $this->main->id, 'name' => 'Table 5']);
        $this->actingAs($manager, 'sanctum')->putJson("/api/tables/{$table5->id}", ['name' => 'Table 4'])->assertStatus(422);
        $this->actingAs($manager, 'sanctum')->putJson("/api/tables/{$table5->id}", ['name' => 'Table 5', 'seats' => 6])->assertOk();
    }

    public function test_a_waiter_cant_set_up_tables(): void
    {
        $this->actingAs($this->user('waiter', $this->main), 'sanctum')
            ->postJson('/api/tables', ['name' => 'Table 9'])->assertForbidden();
    }

    public function test_whoever_opens_a_table_can_list_the_waiters(): void
    {
        $waiter = $this->user('waiter', $this->main);

        $this->actingAs($this->user('manager', $this->main), 'sanctum')
            ->getJson('/api/waiters')->assertOk()
            ->assertJsonPath('data.0.id', $waiter->id);
    }
}
