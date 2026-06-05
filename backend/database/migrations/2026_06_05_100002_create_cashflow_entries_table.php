<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('cashflow_entries', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->enum('flow_type', ['inflow', 'outflow']);
            // category: rental, salary, safe_deposit, safe_withdrawal, ecocash_commission, loan, other
            $table->string('category', 100);
            $table->string('description', 255);
            $table->decimal('amount', 15, 2);
            $table->string('currency', 10)->default('USD');
            $table->date('entry_date');
            $table->string('payment_method', 50)->default('cash');
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cashflow_entries');
    }
};
