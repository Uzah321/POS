<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Nullable, not backfilled — a sale made before this column existed
        // could have come from either mode, so leaving it null (rather than
        // guessing) means reports keep treating it as visible in both, while
        // every sale from here on gets stamped with whichever mode was active
        // when it was rung up.
        Schema::table('sales', function (Blueprint $table) {
            $table->string('business_type', 20)->nullable()->after('branch_id');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn('business_type');
        });
    }
};
