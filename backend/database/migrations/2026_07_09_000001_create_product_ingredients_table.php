<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::dropIfExists('product_ingredients');
        Schema::create('product_ingredients', function (Blueprint $table) {
            $table->id();
            // The finished product this ingredient belongs to (e.g. "Burger")
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            // The raw-material product consumed (e.g. "Beef Patty")
            $table->foreignId('ingredient_product_id')->constrained('products')->cascadeOnDelete();
            // Quantity of the ingredient consumed per 1 unit of the finished product
            $table->decimal('quantity', 12, 3)->default(0);
            $table->timestamps();

            $table->unique(['product_id', 'ingredient_product_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('product_ingredients');
    }
};
