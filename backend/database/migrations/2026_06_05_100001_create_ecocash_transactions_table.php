<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('ecocash_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('branch_id')->constrained();
            $table->foreignId('user_id')->constrained();
            $table->enum('type', ['deposit', 'withdrawal', 'float_top_up', 'float_withdrawal', 'commission']);
            $table->string('ecocash_reference')->nullable();
            $table->string('customer_phone')->nullable();
            $table->decimal('amount', 15, 2);
            $table->decimal('commission_rate', 6, 2)->default(0); // stored as percentage e.g. 3.50
            $table->decimal('commission_amount', 15, 2)->default(0);
            $table->decimal('float_before', 15, 2)->default(0);
            $table->decimal('float_after', 15, 2)->default(0);
            $table->date('transaction_date');
            $table->text('notes')->nullable();
            $table->enum('status', ['completed', 'reversed', 'pending'])->default('completed');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ecocash_transactions');
    }
};
