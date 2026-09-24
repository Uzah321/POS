<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // Products can be entered with more decimals: prices/costs to 6 places
    // (e.g. a cost per gram), and the reorder/alert thresholds become
    // fractional so a product sold by the kg can reorder at e.g. 2.5 kg.
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->decimal('cost_price', 18, 6)->default(0)->change();
            $table->decimal('selling_price', 18, 6)->default(0)->change();
            $table->decimal('wholesale_price', 18, 6)->nullable()->change();
            $table->decimal('reorder_level', 15, 3)->default(5)->change();
            $table->decimal('reorder_quantity', 15, 3)->default(10)->change();
            $table->decimal('alert_quantity', 15, 3)->default(5)->change();
        });

        Schema::table('product_variants', function (Blueprint $table) {
            $table->decimal('cost_price', 18, 6)->nullable()->change();
            $table->decimal('selling_price', 18, 6)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 4)->default(0)->change();
            $table->decimal('selling_price', 15, 4)->default(0)->change();
            $table->decimal('wholesale_price', 15, 4)->nullable()->change();
            $table->integer('reorder_level')->default(5)->change();
            $table->integer('reorder_quantity')->default(10)->change();
            $table->integer('alert_quantity')->default(5)->change();
        });

        Schema::table('product_variants', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 4)->nullable()->change();
            $table->decimal('selling_price', 15, 4)->nullable()->change();
        });
    }
};
