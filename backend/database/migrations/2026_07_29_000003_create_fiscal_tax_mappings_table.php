<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // ZIMRA assigns each taxpayer its own set of taxID values via getConfig's
        // applicableTaxes list — these don't necessarily match this app's local
        // tax_rates ids, so an admin maps each ZIMRA tax to a local TaxRate (or to
        // "exempt/no tax" when local_tax_rate_id is null) before receipts can submit.
        Schema::create('fiscal_tax_mappings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fiscal_device_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('zimra_tax_id');
            $table->decimal('tax_percent', 5, 2)->nullable(); // null = exempt
            $table->string('tax_name', 50);
            $table->date('valid_from');
            $table->date('valid_till')->nullable();
            $table->foreignId('local_tax_rate_id')->nullable()->constrained('tax_rates')->nullOnDelete();
            $table->timestamps();

            $table->unique(['fiscal_device_id', 'zimra_tax_id'], 'fiscal_tax_mappings_device_tax_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fiscal_tax_mappings');
    }
};
