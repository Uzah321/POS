<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->index(['status', 'completed_at'], 'sales_status_completed_at_index');
            $table->index(['status', 'branch_id', 'completed_at'], 'sales_status_branch_completed_at_index');
        });

        Schema::table('sale_items', function (Blueprint $table) {
            $table->index('sale_id', 'sale_items_sale_id_index');
            $table->index('product_id', 'sale_items_product_id_index');
        });

        Schema::table('sale_payments', function (Blueprint $table) {
            $table->index('sale_id', 'sale_payments_sale_id_index');
        });

        Schema::table('stocks', function (Blueprint $table) {
            $table->index('product_id', 'stocks_product_id_index');
        });

        Schema::table('products', function (Blueprint $table) {
            $table->index(['is_active', 'reorder_level'], 'products_active_reorder_level_index');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropIndex('products_active_reorder_level_index');
        });

        Schema::table('stocks', function (Blueprint $table) {
            $table->dropIndex('stocks_product_id_index');
        });

        Schema::table('sale_payments', function (Blueprint $table) {
            $table->dropIndex('sale_payments_sale_id_index');
        });

        Schema::table('sale_items', function (Blueprint $table) {
            $table->dropIndex('sale_items_sale_id_index');
            $table->dropIndex('sale_items_product_id_index');
        });

        Schema::table('sales', function (Blueprint $table) {
            $table->dropIndex('sales_status_completed_at_index');
            $table->dropIndex('sales_status_branch_completed_at_index');
        });
    }
};