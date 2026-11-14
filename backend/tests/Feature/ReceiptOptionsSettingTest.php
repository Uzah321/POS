<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * What a receipt shows is set once in Settings > Receipts & Invoices — and
 * the cashier's till (or the Android app, signed in as the cashier) is what
 * prints it, so a cashier who can't manage settings must still get them.
 * They used to be filtered out: the switches only worked for a manager.
 */
class ReceiptOptionsSettingTest extends TestCase
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

    public function test_a_cashier_gets_what_the_receipt_shows(): void
    {
        $this->actingAs($this->user('manage_settings'))->postJson('/api/settings', [
            'receipt_fiscal_title' => 'false',
            'receipt_show_vat_breakdown' => 'false',
            'receipt_show_cashier' => 'true',
            'receipt_footer' => 'Thank you',
            'some_integration_secret' => 'hidden',
        ])->assertOk();

        $settings = $this->actingAs($this->user())->getJson('/api/settings')->assertOk()->json('data');

        $this->assertSame('false', $settings['receipt_fiscal_title']);
        $this->assertSame('false', $settings['receipt_show_vat_breakdown']);
        $this->assertSame('true', $settings['receipt_show_cashier']);
        $this->assertSame('Thank you', $settings['receipt_footer']);
        // Settings that aren't for the till still aren't sent to it.
        $this->assertArrayNotHasKey('some_integration_secret', $settings);
    }
}
