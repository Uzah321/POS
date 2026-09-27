<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * One-time: on the live install the "admin" account ended up holding the
 * manager role, so it lost Settings, Users, Audit Log, etc. and got "User
 * does not have the right permissions" on the business-type picker. Make it
 * an admin again (admin only — not admin + manager) and make sure the admin
 * role has every permission.
 */
return new class extends Migration
{
    public function up(): void
    {
        $role = Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web']);
        $role->syncPermissions(Permission::all());

        $user = User::where('username', 'admin')->first()
            ?? User::where('email', 'admin@corepos.local')->first();
        if ($user) {
            $user->syncRoles(['admin']);
            if (! $user->is_active) {
                $user->update(['is_active' => true]);
            }
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        // Not reversible — the previous (wrong) role isn't worth restoring.
    }
};
