<?php

use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * The waiter role and the manage_tables permission only ever came from
 * DatabaseSeeder, which updates don't run — so an install seeded before they
 * existed has neither, and every "add a waiter" was rejected ("The selected
 * roles.0 is invalid"). Create whatever is missing with the seeder's
 * defaults; roles and permissions that already exist are left exactly as the
 * admin set them.
 */
return new class extends Migration
{
    public function up(): void
    {
        $manageTables = Permission::where('name', 'manage_tables')->where('guard_name', 'web')->first();
        if (! $manageTables) {
            $manageTables = Permission::create(['name' => 'manage_tables', 'guard_name' => 'web']);
            foreach (['manager', 'cashier'] as $name) {
                Role::where('name', $name)->where('guard_name', 'web')->first()?->givePermissionTo($manageTables);
            }
        }

        if (! Role::where('name', 'waiter')->where('guard_name', 'web')->exists()) {
            $waiter = Role::create(['name' => 'waiter', 'guard_name' => 'web']);
            $createSales = Permission::firstOrCreate(['name' => 'create_sales', 'guard_name' => 'web']);
            $waiter->givePermissionTo($createSales);
        }

        // Admin has every permission, including any created above.
        Role::where('name', 'admin')->where('guard_name', 'web')->first()?->syncPermissions(Permission::all());

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        // Leave the role and permission in place — staff may already hold them.
    }
};
