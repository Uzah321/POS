<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('fiscal_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fiscal_device_id')->constrained()->cascadeOnDelete();
            $table->foreignId('fiscal_day_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sale_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('refund_id')->nullable()->constrained()->cascadeOnDelete();

            $table->enum('receipt_type', ['FiscalInvoice', 'CreditNote', 'DebitNote']);
            $table->unsignedInteger('receipt_counter');
            $table->unsignedBigInteger('receipt_global_no');
            $table->string('invoice_no', 50);
            $table->string('receipt_currency', 3);
            $table->decimal('receipt_total', 21, 2);

            // The exact request body built+signed at allocation time — retries
            // resubmit this verbatim, never rebuilding it, so numbering/signature
            // never drift from what was reserved (see FiscalSubmissionService).
            $table->json('payload');
            $table->string('previous_receipt_hash')->nullable();
            $table->string('device_hash');
            $table->text('device_signature');

            $table->enum('status', ['pending', 'submitted', 'failed'])->default('pending');
            $table->unsignedBigInteger('zimra_receipt_id')->nullable();
            $table->json('server_signature')->nullable();
            $table->string('qr_data')->nullable();
            $table->text('qr_code_url')->nullable();
            $table->string('validation_note')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->text('last_error')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();

            $table->unique(['fiscal_device_id', 'receipt_global_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fiscal_receipts');
    }
};
