<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->foreignId('branch_id')->nullable()->after('id')->constrained('branches')->nullOnDelete();
        });

        $firstBranchId = DB::table('branches')->orderBy('id')->value('id');
        if ($firstBranchId) {
            DB::table('customers')->whereNull('branch_id')->update(['branch_id' => $firstBranchId]);
        }

        // email used to be globally unique (one shared customer list). Now that
        // each branch owns its own customers, the same real-world person could
        // legitimately be a separate customer record per branch.
        Schema::table('customers', function (Blueprint $table) {
            $table->dropUnique('customers_email_unique');
            $table->unique(['branch_id', 'email'], 'customers_branch_email_unique');
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropUnique('customers_branch_email_unique');
            $table->unique('email');
        });

        Schema::table('customers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
    }
};
