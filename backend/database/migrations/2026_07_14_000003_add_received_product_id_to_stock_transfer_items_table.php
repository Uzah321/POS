<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_transfer_items', function (Blueprint $table) {
            // product_id always refers to the SOURCE branch's catalog row (what
            // was dispatched). Once each branch owns a separate catalog, the
            // destination branch may not have a matching row yet — receive()
            // resolves (or auto-creates) the destination's own product and
            // records it here, so the transfer stays auditable on both sides.
            $table->foreignId('received_product_id')->nullable()->after('product_id')->constrained('products')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('stock_transfer_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('received_product_id');
        });
    }
};
