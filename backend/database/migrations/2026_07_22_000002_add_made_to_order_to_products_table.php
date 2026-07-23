<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // A made-to-order item (e.g. a pizza) is assembled from its recipe at the
            // moment it's sold — it never carries its own stock. When true, sales deduct
            // the linked ingredients instead of this product's stock row, and its
            // in-stock/out-of-stock status is derived from ingredient availability.
            $table->boolean('made_to_order')->default(false)->after('track_stock');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('made_to_order');
        });
    }
};
