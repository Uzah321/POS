<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('held_sales', function (Blueprint $table) {
            $table->string('order_status')->default('open')->after('note');
            $table->string('table_number', 20)->nullable()->after('order_status');
        });

        Schema::table('sales', function (Blueprint $table) {
            $table->string('table_number', 20)->nullable()->after('notes');
        });
    }

    public function down(): void
    {
        Schema::table('held_sales', function (Blueprint $table) {
            $table->dropColumn(['order_status', 'table_number']);
        });
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn('table_number');
        });
    }
};
