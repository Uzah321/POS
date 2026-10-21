<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // A till can fiscalise through GoFiscal (api.gofiscal.app) instead of
        // its own ZIMRA-registered device: the engine holds the device, signs,
        // numbers and talks to ZIMRA. This is the engine's deviceId for the till.
        Schema::table('registers', function (Blueprint $table) {
            $table->unsignedInteger('gofiscal_device_id')->nullable()->after('code');
        });

        // One row per sale / refund sent to GoFiscal, and what came back. Unlike
        // fiscal_receipts, nothing is numbered or signed here — the engine does
        // that and returns the receipt's numbers, verification code and QR link.
        Schema::create('gofiscal_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sale_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('refund_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('register_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedInteger('device_id');

            $table->string('receipt_type', 20); // FiscalInvoice | CreditNote
            $table->string('invoice_no', 50);   // the engine's idempotency key
            $table->string('receipt_currency', 3);
            $table->decimal('receipt_total', 21, 2);
            $table->json('payload');

            // pending: not through yet, retried · submitted: the engine numbered
            // and signed it (engine_status accepted or queued) · failed: refused,
            // needs fixing before it's sent again
            $table->string('status', 20)->default('pending');
            $table->string('engine_status', 20)->nullable();
            $table->unsignedBigInteger('receipt_global_no')->nullable();
            $table->unsignedInteger('receipt_counter')->nullable();
            $table->unsignedInteger('fiscal_day_no')->nullable();
            $table->string('qr_data', 64)->nullable(); // verification code, without dashes
            $table->text('qr_code_url')->nullable();
            $table->json('response')->nullable();

            $table->string('error_code', 50)->nullable();
            $table->text('last_error')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();

            $table->index(['device_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gofiscal_receipts');
        Schema::table('registers', function (Blueprint $table) {
            $table->dropColumn('gofiscal_device_id');
        });
    }
};
