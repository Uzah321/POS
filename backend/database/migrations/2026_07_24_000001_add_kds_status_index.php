<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // The kitchen display polls this column every 6s with no branch/date
        // bound, so it was doing a full table scan of sales on every request.
        Schema::table('sales', function (Blueprint $table) {
            $table->index('kds_status', 'sales_kds_status_idx');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropIndex('sales_kds_status_idx');
        });
    }
};
