<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * The company logo is saved with the other settings (a data URL a few
 * hundred KB at most) and every till gets it, since cashiers print the
 * receipts it goes on.
 */
class CompanyLogoSettingTest extends TestCase
{
    use RefreshDatabase;

    private function user(?string $permission = null): User
    {
        $user = User::create([
            'name' => 'User', 'username' => 'user' . uniqid(), 'password' => bcrypt('secret1'), 'is_active' => true,
        ]);
        if ($permission) {
            $role = Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web']);
            $role->givePermissionTo(Permission::firstOrCreate(['name' => $permission, 'guard_name' => 'web']));
            $user->assignRole($role);
        }
        return $user;
    }

    public function test_a_saved_logo_reaches_a_cashier_who_cannot_manage_settings(): void
    {
        $logo = 'data:image/png;base64,' . str_repeat('A', 250000);

        $this->actingAs($this->user('manage_settings'))
            ->postJson('/api/settings', ['company_name' => 'Mazowe Butchery', 'company_logo' => $logo])
            ->assertOk();

        $settings = $this->actingAs($this->user())->getJson('/api/settings')->assertOk()->json('data');
        $this->assertSame($logo, $settings['company_logo']);
        $this->assertSame('Mazowe Butchery', $settings['company_name']);
    }

    public function test_removing_the_logo_clears_it(): void
    {
        $admin = $this->user('manage_settings');
        $this->actingAs($admin)->postJson('/api/settings', ['company_logo' => 'data:image/png;base64,AAAA'])->assertOk();
        $this->actingAs($admin)->postJson('/api/settings', ['company_logo' => ''])->assertOk();

        $this->assertEmpty($this->actingAs($admin)->getJson('/api/settings')->json('data.company_logo'));
    }
}
