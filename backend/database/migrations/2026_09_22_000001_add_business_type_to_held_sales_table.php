<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('held_sales', function (Blueprint $table) {
            $table->string('business_type', 20)->nullable()->after('branch_id');
        });
    }

    public function down(): void
    {
        Schema::table('held_sales', function (Blueprint $table) {
            $table->dropColumn('business_type');
        });
    }
};
