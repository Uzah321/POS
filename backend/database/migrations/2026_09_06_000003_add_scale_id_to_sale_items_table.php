<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            // Snapshot of the product's assigned scale at sale time, so per-scale
            // reports stay accurate even if the product is later reassigned to a
            // different scale (or the scale is deleted/renamed).
            $table->foreignId('scale_id')->nullable()->after('product_id')
                ->constrained('weighing_scales')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('scale_id');
        });
    }
};
