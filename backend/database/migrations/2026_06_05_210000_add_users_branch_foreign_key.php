<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasTable('branches') || ! Schema::hasColumn('users', 'branch_id')) {
            return;
        }

        if ($this->foreignKeyExists()) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('users') || ! $this->foreignKeyExists()) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign('users_branch_id_foreign');
        });
    }

    private function foreignKeyExists(): bool
    {
        return match (Schema::getConnection()->getDriverName()) {
            'pgsql' => (bool) DB::scalar(
                "select exists (
                    select 1
                    from pg_constraint
                    where conname = ?
                )",
                ['users_branch_id_foreign']
            ),
            'mysql' => (bool) DB::scalar(
                "select exists (
                    select 1
                    from information_schema.table_constraints
                    where constraint_schema = database()
                      and table_name = ?
                      and constraint_name = ?
                      and constraint_type = 'FOREIGN KEY'
                )",
                ['users', 'users_branch_id_foreign']
            ),
            default => false,
        };
    }
};