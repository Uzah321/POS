<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Expense Categories
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Expenses
        Schema::create('expenses', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('expense_category_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('description');
            $table->decimal('amount', 15, 2);
            $table->date('expense_date');
            $table->string('receipt_image')->nullable();
            $table->enum('status', ['pending','approved','rejected'])->default('approved');
            $table->timestamps();
        });

        // End of Day (Cash Reconciliation)
        Schema::create('end_of_day', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->date('report_date');
            $table->decimal('opening_cash', 15, 2)->default(0);
            $table->decimal('cash_sales', 15, 2)->default(0);
            $table->decimal('card_sales', 15, 2)->default(0);
            $table->decimal('mobile_money_sales', 15, 2)->default(0);
            $table->decimal('other_sales', 15, 2)->default(0);
            $table->decimal('total_sales', 15, 2)->default(0);
            $table->decimal('total_refunds', 15, 2)->default(0);
            $table->decimal('total_expenses', 15, 2)->default(0);
            $table->decimal('expected_cash', 15, 2)->default(0);
            $table->decimal('actual_cash', 15, 2)->default(0);
            $table->decimal('difference', 15, 2)->default(0);
            $table->text('notes')->nullable();
            $table->enum('status', ['draft','closed'])->default('draft');
            $table->timestamps();
        });

        // Coupons & Promotions
        Schema::create('promotions', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('code')->unique()->nullable();
            $table->enum('type', ['percent','fixed','buy_x_get_y','free_shipping']);
            $table->decimal('value', 10, 2);
            $table->decimal('minimum_purchase', 15, 2)->default(0);
            $table->decimal('maximum_discount', 15, 2)->nullable();
            $table->integer('usage_limit')->nullable();
            $table->integer('usage_count')->default(0);
            $table->boolean('is_active')->default(true);
            $table->date('starts_at')->nullable();
            $table->date('expires_at')->nullable();
            $table->timestamps();
        });

        // Loyalty Program
        Schema::create('loyalty_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained();
            $table->foreignId('sale_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('type', ['earned','redeemed','adjusted','expired']);
            $table->integer('points');
            $table->integer('balance_after');
            $table->text('note')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('loyalty_transactions');
        Schema::dropIfExists('promotions');
        Schema::dropIfExists('end_of_day');
        Schema::dropIfExists('expenses');
        Schema::dropIfExists('expense_categories');
    }
};
