<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('currencies', function (Blueprint $table) {
            $table->id();
            $table->string('code', 10)->unique();  // USD, ZAR, EUR ...
            $table->string('name');
            $table->string('symbol', 10);
            $table->decimal('exchange_rate', 15, 6)->default(1.000000); // units of this currency per 1 USD
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Add currency tracking to sales
        Schema::table('sales', function (Blueprint $table) {
            $table->string('currency_code', 10)->default('USD')->after('status');
            $table->decimal('exchange_rate', 15, 6)->default(1.000000)->after('currency_code');
        });

        // Add currency tracking to purchase orders
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->string('currency_code', 10)->default('USD')->after('status');
            $table->decimal('exchange_rate', 15, 6)->default(1.000000)->after('currency_code');
        });

        // Add currency tracking to expenses
        Schema::table('expenses', function (Blueprint $table) {
            $table->string('currency_code', 10)->default('USD')->after('amount');
            $table->decimal('exchange_rate', 15, 6)->default(1.000000)->after('currency_code');
            $table->decimal('amount_usd', 15, 2)->default(0)->after('exchange_rate');
        });
    }

    public function down(): void
    {
        Schema::table('expenses', function (Blueprint $table) {
            $table->dropColumn(['currency_code', 'exchange_rate', 'amount_usd']);
        });
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn(['currency_code', 'exchange_rate']);
        });
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn(['currency_code', 'exchange_rate']);
        });
        Schema::dropIfExists('currencies');
    }
};
