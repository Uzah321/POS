<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Stock Adjustments
        Schema::create('stock_adjustments', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('warehouse_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->enum('type', ['in','out','damage','correction','opening','return']);
            $table->text('reason')->nullable();
            $table->timestamps();
        });

        // Stock Adjustment Items
        Schema::create('stock_adjustment_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_adjustment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained();
            $table->foreignId('product_variant_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('quantity_before', 15, 3)->default(0);
            $table->decimal('quantity_adjusted', 15, 3);
            $table->decimal('quantity_after', 15, 3)->default(0);
            $table->decimal('cost_price', 15, 2)->default(0);
            $table->timestamps();
        });

        // Stock Transfers (inter-warehouse)
        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('from_warehouse_id')->constrained('warehouses');
            $table->foreignId('to_warehouse_id')->constrained('warehouses');
            $table->foreignId('created_by')->constrained('users');
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('status', ['draft','pending','in_transit','received','cancelled'])->default('draft');
            $table->date('transfer_date');
            $table->text('notes')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('received_at')->nullable();
            $table->timestamps();
        });

        // Transfer Items
        Schema::create('stock_transfer_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_transfer_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained();
            $table->foreignId('product_variant_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('quantity', 15, 3);
            $table->decimal('received_quantity', 15, 3)->default(0);
            $table->timestamps();
        });

        // Stock Count (stocktake)
        Schema::create('stock_counts', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('warehouse_id')->constrained();
            $table->foreignId('created_by')->constrained('users');
            $table->enum('status', ['draft','in_progress','completed'])->default('draft');
            $table->text('notes')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
        });

        // Stock Count Items
        Schema::create('stock_count_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_count_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained();
            $table->foreignId('product_variant_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('system_quantity', 15, 3)->default(0);
            $table->decimal('counted_quantity', 15, 3)->nullable();
            $table->decimal('difference', 15, 3)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_count_items');
        Schema::dropIfExists('stock_counts');
        Schema::dropIfExists('stock_transfer_items');
        Schema::dropIfExists('stock_transfers');
        Schema::dropIfExists('stock_adjustment_items');
        Schema::dropIfExists('stock_adjustments');
    }
};
