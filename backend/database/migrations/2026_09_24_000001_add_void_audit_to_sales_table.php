<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The voids report needs who voided a sale, when, and why — until now a
        // void only flipped `status`, so the only trace was `updated_at` and the
        // original cashier (who is often not the person who voided it).
        Schema::table('sales', function (Blueprint $table) {
            $table->foreignId('voided_by')->nullable()->after('status')->constrained('users')->nullOnDelete();
            $table->timestamp('voided_at')->nullable()->after('voided_by');
            $table->string('void_reason')->nullable()->after('voided_at');
        });

        // Best available timestamp for voids recorded before this column existed.
        DB::table('sales')->where('status', 'voided')->whereNull('voided_at')->update(['voided_at' => DB::raw('updated_at')]);
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropConstrainedForeignId('voided_by');
            $table->dropColumn(['voided_at', 'void_reason']);
        });
    }
};
