<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Audit trail for every manual ingredient stock change (top-ups and
        // wastage/damage write-offs) — one row per change, since the
        // Ingredients page always adjusts a single ingredient at a time
        // (unlike Products' StockAdjustment, which batches several product
        // lines under one adjustment reference).
        Schema::create('ingredient_stock_adjustments', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('ingredient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('warehouse_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->enum('type', ['in', 'out', 'damage', 'correction']);
            $table->text('reason')->nullable();
            $table->decimal('quantity_before', 15, 3)->default(0);
            $table->decimal('quantity_adjusted', 15, 3);
            $table->decimal('quantity_after', 15, 3)->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_stock_adjustments');
    }
};
