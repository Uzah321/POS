<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sale amounts are stored in the base currency (USD) and shown in the till's
 * currency (amount x rate). At 2 decimals a sale rung up in another currency
 * lost its value on the way: at R17 to the dollar, R1.00 is $0.0588, saved as
 * $0.06, which printed on the receipt as R1.02. Products already keep 6
 * decimals for the same reason (2026_09_25_000001); sales, payments and
 * refunds now do too.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            foreach (['subtotal', 'discount_amount', 'tax_amount', 'total', 'amount_paid', 'change_due', 'discount_value'] as $column) {
                $table->decimal($column, 18, 6)->default(0)->change();
            }
        });

        Schema::table('sale_items', function (Blueprint $table) {
            $table->decimal('unit_price', 18, 6)->change();
            $table->decimal('cost_price', 18, 6)->default(0)->change();
            $table->decimal('discount_amount', 18, 6)->default(0)->change();
            $table->decimal('tax_amount', 18, 6)->default(0)->change();
            $table->decimal('subtotal', 18, 6)->change();
            $table->decimal('total', 18, 6)->change();
            $table->decimal('discount_value', 18, 6)->default(0)->change();
        });

        Schema::table('sale_payments', fn (Blueprint $table) => $table->decimal('amount', 18, 6)->change());
        Schema::table('refunds', fn (Blueprint $table) => $table->decimal('amount', 18, 6)->change());
        Schema::table('refund_items', fn (Blueprint $table) => $table->decimal('amount', 18, 6)->change());
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            foreach (['subtotal', 'discount_amount', 'tax_amount', 'total', 'amount_paid', 'change_due'] as $column) {
                $table->decimal($column, 15, 2)->default(0)->change();
            }
            $table->decimal('discount_value', 10, 2)->default(0)->change();
        });

        Schema::table('sale_items', function (Blueprint $table) {
            $table->decimal('unit_price', 15, 2)->change();
            $table->decimal('cost_price', 15, 2)->default(0)->change();
            $table->decimal('discount_amount', 15, 2)->default(0)->change();
            $table->decimal('tax_amount', 15, 2)->default(0)->change();
            $table->decimal('subtotal', 15, 2)->change();
            $table->decimal('total', 15, 2)->change();
            $table->decimal('discount_value', 10, 2)->default(0)->change();
        });

        Schema::table('sale_payments', fn (Blueprint $table) => $table->decimal('amount', 15, 2)->change());
        Schema::table('refunds', fn (Blueprint $table) => $table->decimal('amount', 15, 2)->change());
        Schema::table('refund_items', fn (Blueprint $table) => $table->decimal('amount', 15, 2)->change());
    }
};
