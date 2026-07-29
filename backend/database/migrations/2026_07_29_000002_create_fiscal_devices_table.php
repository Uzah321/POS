<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // One row per register — a ZIMRA-registered fiscal device. Everything
        // needed to talk to the Fiscal Device Gateway API for that till lives here:
        // its keypair/certificate, ZIMRA-assigned identity, and cached config.
        Schema::create('fiscal_devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('register_id')->unique()->constrained()->cascadeOnDelete();

            // ZIMRA identity, assigned via the taxpayer's ZIMRA portal registration.
            $table->unsignedInteger('device_id')->nullable();
            $table->text('activation_key')->nullable(); // encrypted cast; only needed once, at registerDevice time
            $table->string('device_serial_no', 20)->nullable();

            // Locally generated keypair + the certificate ZIMRA issues back.
            $table->enum('key_algorithm', ['ecc', 'rsa'])->default('ecc');
            $table->text('private_key')->nullable(); // encrypted cast — never written decrypted to disk
            $table->text('certificate')->nullable();
            $table->date('certificate_valid_till')->nullable();

            $table->enum('environment', ['test', 'live'])->default('test');
            $table->enum('operating_mode', ['online', 'offline'])->nullable(); // from getConfig

            // Cached taxpayer/branch info from getConfig — informational, for display only.
            $table->string('taxpayer_name')->nullable();
            $table->string('taxpayer_tin', 10)->nullable();
            $table->string('vat_number', 9)->nullable();
            $table->string('branch_name')->nullable();
            $table->json('branch_address')->nullable();
            $table->unsignedInteger('tax_payer_day_max_hrs')->nullable();
            $table->unsignedInteger('tax_payer_day_end_notification_hrs')->nullable();
            $table->string('qr_url')->nullable();

            // Receipt numbering — allocated once per receipt, in the same DB
            // transaction as the sale/refund, and never reused or skipped (see
            // FiscalSubmissionService). receiptCounter resets per fiscal day and
            // lives on fiscal_days instead.
            $table->unsignedBigInteger('next_receipt_global_no')->default(1);

            $table->enum('status', ['unregistered', 'registered', 'error'])->default('unregistered');
            $table->text('last_error')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fiscal_devices');
    }
};
