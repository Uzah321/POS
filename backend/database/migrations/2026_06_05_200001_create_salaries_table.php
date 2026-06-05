<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('salaries', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('created_by')->constrained('users');
            // The employee — can be a system user or a named non-user employee
            $table->foreignId('employee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('employee_name');        // display name (copied from user or entered manually)
            $table->string('position')->nullable(); // job title
            $table->string('pay_month');            // YYYY-MM e.g. "2026-06"
            $table->decimal('basic_salary', 15, 2)->default(0);
            $table->decimal('housing_allowance', 15, 2)->default(0);
            $table->decimal('transport_allowance', 15, 2)->default(0);
            $table->decimal('other_allowances', 15, 2)->default(0);
            $table->decimal('gross_salary', 15, 2)->default(0); // basic + all allowances
            $table->decimal('paye', 15, 2)->default(0);         // income tax
            $table->decimal('nssa', 15, 2)->default(0);         // social security
            $table->decimal('other_deductions', 15, 2)->default(0);
            $table->decimal('total_deductions', 15, 2)->default(0);
            $table->decimal('net_salary', 15, 2)->default(0);   // gross - deductions
            $table->enum('status', ['pending', 'paid'])->default('pending');
            $table->string('payment_method')->nullable();
            $table->date('paid_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->unique(['employee_name', 'pay_month', 'branch_id'], 'salary_employee_month_branch');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('salaries');
    }
};
