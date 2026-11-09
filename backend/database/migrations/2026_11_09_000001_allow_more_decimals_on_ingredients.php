<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // Ingredients are usually costed per gram or ml (flour at $0.0012/g), which
    // two decimals rounded to $0.00 — and a recipe built from them to no cost
    // at all. Same 6 places products got in 2026_09_25.
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table) {
            $table->decimal('cost_price', 18, 6)->default(0)->change();
        });

        Schema::table('ingredient_vendors', function (Blueprint $table) {
            $table->decimal('vendor_cost', 18, 6)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('ingredients', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 2)->default(0)->change();
        });

        Schema::table('ingredient_vendors', function (Blueprint $table) {
            $table->decimal('vendor_cost', 15, 2)->nullable()->change();
        });
    }
};
