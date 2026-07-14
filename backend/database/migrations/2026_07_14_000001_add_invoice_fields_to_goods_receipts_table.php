<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('goods_receipts', function (Blueprint $table) {
            $table->string('invoice_number')->nullable()->after('notes');
            $table->date('invoice_date')->nullable()->after('invoice_number');
            $table->decimal('invoice_amount', 15, 2)->nullable()->after('invoice_date');
        });
    }

    public function down(): void
    {
        Schema::table('goods_receipts', function (Blueprint $table) {
            $table->dropColumn(['invoice_number', 'invoice_date', 'invoice_amount']);
        });
    }
};
