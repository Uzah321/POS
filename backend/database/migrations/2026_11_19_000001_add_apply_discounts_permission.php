<?php

use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * The POS Discount key: selling at a discount needs apply_discounts, which
 * admins and managers get (cashiers and waiters don't). Updates don't run
 * DatabaseSeeder, so it's created here; a manager role an admin has already
 * reshaped still gets it, since discounts were never possible before.
 */
return new class extends Migration
{
    public function up(): void
    {
        $permission = Permission::firstOrCreate(['name' => 'apply_discounts', 'guard_name' => 'web']);
        Role::where('name', 'manager')->where('guard_name', 'web')->first()?->givePermissionTo($permission);

        // Admin has every permission, including this one.
        Role::where('name', 'admin')->where('guard_name', 'web')->first()?->syncPermissions(Permission::all());

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        // Leave it in place — staff may already hold it.
    }
};
