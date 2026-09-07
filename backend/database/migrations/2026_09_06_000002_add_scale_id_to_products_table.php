<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Which scale's own item list this weighed product belongs to — e.g. a
            // "Meat Scale" only ever weighs the products assigned to it here. Only
            // meaningful when sold_by_weight is true; null just means "not assigned
            // to a specific scale yet" for an existing weighed product.
            $table->foreignId('scale_id')->nullable()->after('sold_by_weight')
                ->constrained('weighing_scales')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropConstrainedForeignId('scale_id');
        });
    }
};
