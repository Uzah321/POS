<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('fiscal_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fiscal_device_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('fiscal_day_no');
            $table->enum('status', ['opened', 'closed', 'close_initiated', 'close_failed'])->default('opened');
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();

            // Running totals per §6 Fiscal counters (SaleByTax, SaleTaxByTax,
            // CreditNoteByTax, CreditNoteTaxByTax, DebitNoteByTax, DebitNoteTaxByTax,
            // BalanceByMoneyType), keyed by type+currency+tax/money-type. Reset to
            // empty on each new fiscal day.
            $table->json('counters')->nullable();

            // receiptCounter resets to 0 each fiscal day (unlike receipt_global_no,
            // which is cumulative on fiscal_devices).
            $table->unsignedInteger('last_receipt_counter')->default(0);

            $table->string('closing_error_code')->nullable();
            $table->text('device_signature')->nullable();
            $table->json('server_signature')->nullable();
            $table->timestamps();

            $table->unique(['fiscal_device_id', 'fiscal_day_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fiscal_days');
    }
};
