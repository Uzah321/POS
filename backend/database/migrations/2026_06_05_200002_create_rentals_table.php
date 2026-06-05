<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('rentals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('created_by')->constrained('users');
            $table->string('property_name');
            $table->string('property_type')->default('commercial'); // commercial, residential, storage
            $table->string('tenant_name');
            $table->string('tenant_phone')->nullable();
            $table->string('tenant_email')->nullable();
            $table->decimal('monthly_amount', 15, 2);
            $table->string('currency', 10)->default('USD');
            $table->date('lease_start');
            $table->date('lease_end')->nullable();
            $table->enum('flow_type', ['income', 'expense'])->default('income'); // we collect rent (income) or we pay rent (expense)
            $table->enum('status', ['active', 'expired', 'terminated'])->default('active');
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('rental_payments', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('rental_id')->constrained()->cascadeOnDelete();
            $table->foreignId('recorded_by')->constrained('users');
            $table->string('period');          // YYYY-MM of the rent period being paid
            $table->decimal('amount', 15, 2);
            $table->date('payment_date');
            $table->string('payment_method')->default('cash');
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rental_payments');
        Schema::dropIfExists('rentals');
    }
};
