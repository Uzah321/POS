<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->string('kds_status', 20)->nullable()->after('status');
            // new | preparing | ready | served
        });
    }
    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn('kds_status');
        });
    }
};
