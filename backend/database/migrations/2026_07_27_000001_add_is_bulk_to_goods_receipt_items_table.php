<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('goods_receipt_items', function (Blueprint $table) {
            // Whether this line was physically received as sealed cases/bulk packs
            // (needing a case-break before it's sellable as individual units) or as
            // loose singles, ready to sell as received.
            $table->boolean('is_bulk')->default(false)->after('quantity');
        });
    }

    public function down(): void
    {
        Schema::table('goods_receipt_items', function (Blueprint $table) {
            $table->dropColumn('is_bulk');
        });
    }
};
