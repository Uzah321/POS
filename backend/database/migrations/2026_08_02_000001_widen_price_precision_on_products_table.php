<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Prices are stored in USD (the base currency) and converted to/from the
// active currency on the frontend. With only 2 decimal places, a ZAR entry
// like R120 divided by the exchange rate rounds to the nearest USD cent,
// and converting that back to ZAR for display amplifies the rounding into
// a visible few-cent drift (e.g. R120 -> R120.02). Widening to 4 decimal
// places keeps that round-trip error below a hundredth of a cent.
return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 4)->default(0)->change();
            $table->decimal('selling_price', 15, 4)->default(0)->change();
            $table->decimal('wholesale_price', 15, 4)->nullable()->change();
        });

        Schema::table('product_variants', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 4)->nullable()->change();
            $table->decimal('selling_price', 15, 4)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 2)->default(0)->change();
            $table->decimal('selling_price', 15, 2)->default(0)->change();
            $table->decimal('wholesale_price', 15, 2)->nullable()->change();
        });

        Schema::table('product_variants', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 2)->nullable()->change();
            $table->decimal('selling_price', 15, 2)->nullable()->change();
        });
    }
};
