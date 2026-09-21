<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * A user can be assigned to the restaurant or supermarket side. Assigned
 * (non-admin) users are locked to it; unassigned users and admins keep
 * following the system-wide mode.
 */
class UserShopAssignmentTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Category::create(['name' => 'Burgers', 'slug' => 'burgers', 'business_type' => 'restaurant']);
        Category::create(['name' => 'Groceries', 'slug' => 'groceries', 'business_type' => 'supermarket']);
        Category::create(['name' => 'Drinks', 'slug' => 'drinks', 'business_type' => 'both']);
        Setting::set('business_type', 'restaurant');
    }

    private function user(string $role, ?string $shop = null): User
    {
        $user = User::create([
            'name' => ucfirst($role), 'username' => $role . uniqid(), 'password' => bcrypt('secret1'),
            'business_type' => $shop, 'is_active' => true,
        ]);
        Role::firstOrCreate(['name' => $role, 'guard_name' => 'web']);
        $user->assignRole($role);
        return $user;
    }

    private function categoryNames(User $user, array $query = []): array
    {
        return collect($this->actingAs($user)->getJson('/api/categories?' . http_build_query($query))->assertOk()->json('data'))
            ->pluck('name')->sort()->values()->all();
    }

    public function test_admin_can_assign_a_shop_when_creating_a_user(): void
    {
        $admin = $this->user('admin');
        $admin->givePermissionTo(Permission::firstOrCreate(['name' => 'manage_users', 'guard_name' => 'web']));
        Role::firstOrCreate(['name' => 'cashier', 'guard_name' => 'web']);

        $this->actingAs($admin)->postJson('/api/users', [
            'name' => 'Till One', 'username' => 'till1', 'password' => 'secret1',
            'roles' => ['cashier'], 'business_type' => 'supermarket',
        ])->assertCreated()->assertJsonPath('data.business_type', 'supermarket');

        $this->assertSame('supermarket', User::where('username', 'till1')->value('business_type'));
    }

    public function test_an_unknown_shop_is_rejected(): void
    {
        $admin = $this->user('admin');
        $admin->givePermissionTo(Permission::firstOrCreate(['name' => 'manage_users', 'guard_name' => 'web']));
        Role::firstOrCreate(['name' => 'cashier', 'guard_name' => 'web']);

        $this->actingAs($admin)->postJson('/api/users', [
            'name' => 'X', 'username' => 'x1', 'password' => 'secret1', 'roles' => ['cashier'], 'business_type' => 'bakery',
        ])->assertStatus(422);
    }

    public function test_a_supermarket_cashier_only_sees_supermarket_data_even_when_the_system_is_in_restaurant_mode(): void
    {
        $cashier = $this->user('cashier', 'supermarket');

        $this->assertSame(['Drinks', 'Groceries'], $this->categoryNames($cashier));
    }

    public function test_a_locked_user_cannot_override_their_shop_with_a_request_parameter(): void
    {
        $cashier = $this->user('cashier', 'supermarket');

        $this->assertSame(['Drinks', 'Groceries'], $this->categoryNames($cashier, ['business_type' => 'restaurant']));
        $this->assertSame(['Drinks', 'Groceries'], $this->categoryNames($cashier, ['business_type' => 'all']));
    }

    public function test_an_unassigned_user_follows_the_system_mode(): void
    {
        $cashier = $this->user('cashier');

        $this->assertSame(['Burgers', 'Drinks'], $this->categoryNames($cashier));

        Setting::set('business_type', 'supermarket');
        $this->assertSame(['Drinks', 'Groceries'], $this->categoryNames($cashier));
    }

    public function test_an_admin_is_not_locked_and_can_look_at_either_side(): void
    {
        $admin = $this->user('admin', 'restaurant');

        $this->assertSame(['Burgers', 'Drinks'], $this->categoryNames($admin));
        $this->assertSame(['Drinks', 'Groceries'], $this->categoryNames($admin, ['business_type' => 'supermarket']));
        $this->assertSame(['Burgers', 'Drinks', 'Groceries'], $this->categoryNames($admin, ['business_type' => 'all']));
    }

    public function test_the_login_payload_includes_the_users_shop(): void
    {
        $user = $this->user('cashier', 'restaurant');

        $this->postJson('/api/auth/login', ['username' => $user->username, 'password' => 'secret1'])
            ->assertOk()->assertJsonPath('data.user.business_type', 'restaurant');
    }
}
