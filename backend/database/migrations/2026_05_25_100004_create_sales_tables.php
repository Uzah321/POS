<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Sales (POS transactions)
        Schema::create('sales', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('warehouse_id')->constrained();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->constrained(); // cashier
            $table->enum('status', ['draft','completed','refunded','partially_refunded','voided'])->default('draft');
            $table->decimal('subtotal', 15, 2)->default(0);
            $table->decimal('discount_amount', 15, 2)->default(0);
            $table->decimal('tax_amount', 15, 2)->default(0);
            $table->decimal('total', 15, 2)->default(0);
            $table->decimal('amount_paid', 15, 2)->default(0);
            $table->decimal('change_due', 15, 2)->default(0);
            $table->string('discount_type')->nullable(); // fixed | percent
            $table->decimal('discount_value', 10, 2)->default(0);
            $table->string('coupon_code')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('is_offline')->default(false);
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        // Sale Line Items
        Schema::create('sale_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sale_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained();
            $table->foreignId('product_variant_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('quantity', 15, 3);
            $table->decimal('unit_price', 15, 2);
            $table->decimal('cost_price', 15, 2)->default(0);
            $table->decimal('discount_amount', 15, 2)->default(0);
            $table->decimal('tax_amount', 15, 2)->default(0);
            $table->decimal('subtotal', 15, 2);
            $table->decimal('total', 15, 2);
            $table->string('discount_type')->nullable();
            $table->decimal('discount_value', 10, 2)->default(0);
            $table->text('note')->nullable();
            $table->timestamps();
        });

        // Sale Payments
        Schema::create('sale_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sale_id')->constrained()->cascadeOnDelete();
            $table->enum('method', ['cash','card','mobile_money','bank_transfer','loyalty_points','credit','other']);
            $table->decimal('amount', 15, 2);
            $table->string('reference')->nullable(); // card/mobile ref
            $table->text('note')->nullable();
            $table->timestamps();
        });

        // Refunds
        Schema::create('refunds', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('sale_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->decimal('amount', 15, 2);
            $table->text('reason')->nullable();
            $table->enum('status', ['pending','completed','rejected'])->default('pending');
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
        });

        // Refund Items
        Schema::create('refund_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('refund_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sale_item_id')->constrained();
            $table->decimal('quantity', 15, 3);
            $table->decimal('amount', 15, 2);
            $table->boolean('restock')->default(true);
            $table->timestamps();
        });

        // Held (parked) sales
        Schema::create('held_sales', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->json('cart_data'); // full cart snapshot
            $table->text('note')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('held_sales');
        Schema::dropIfExists('refund_items');
        Schema::dropIfExists('refunds');
        Schema::dropIfExists('sale_payments');
        Schema::dropIfExists('sale_items');
        Schema::dropIfExists('sales');
    }
};
