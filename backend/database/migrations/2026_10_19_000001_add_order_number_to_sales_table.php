<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The short number a customer is called by (receipt, kitchen ticket,
     * kitchen/queue screens): counts up from 1 per branch and starts again
     * after each Day End — see Sale::nextOrderNumber(). A Day End records the
     * branch's last sale so numbering knows where the new day begins. Sales
     * made before this keep no number and show their id as before.
     */
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->unsignedInteger('order_number')->nullable()->after('reference');
        });
        Schema::table('end_of_day', function (Blueprint $table) {
            $table->unsignedBigInteger('last_sale_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('end_of_day', function (Blueprint $table) {
            $table->dropColumn('last_sale_id');
        });
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn('order_number');
        });
    }
};
