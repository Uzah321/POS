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
        Schema::create('shift_ends', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('user_id')->constrained(); // cashier
            $table->dateTime('shift_start')->nullable();
            $table->dateTime('shift_end');
            $table->decimal('total_sales', 15, 2)->default(0);
            $table->decimal('cash_sales', 15, 2)->default(0);
            $table->decimal('card_sales', 15, 2)->default(0);
            $table->decimal('mobile_money_sales', 15, 2)->default(0);
            $table->decimal('other_sales', 15, 2)->default(0);
            $table->integer('total_transactions')->default(0);
            $table->decimal('declared_cash', 15, 2)->default(0);
            $table->decimal('expected_cash', 15, 2)->default(0);
            $table->decimal('variance', 15, 2)->default(0);
            $table->text('notes')->nullable();
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shift_ends');
    }
};
