<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Every dashboard/report query filters sales by branch + status + a
        // completed_at date range (or groups by DATE(completed_at)) — without
        // this composite index those queries fall back to a full table scan
        // as the sales table grows, which is the main cause of slow dashboard
        // and report loads.
        Schema::table('sales', function (Blueprint $table) {
            $table->index(['branch_id', 'status', 'completed_at'], 'sales_branch_status_completed_idx');
            $table->index('completed_at', 'sales_completed_at_idx');
        });

        // Expense reports filter identically by branch + date range.
        Schema::table('expenses', function (Blueprint $table) {
            $table->index(['branch_id', 'expense_date'], 'expenses_branch_date_idx');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropIndex('sales_branch_status_completed_idx');
            $table->dropIndex('sales_completed_at_idx');
        });

        Schema::table('expenses', function (Blueprint $table) {
            $table->dropIndex('expenses_branch_date_idx');
        });
    }
};
