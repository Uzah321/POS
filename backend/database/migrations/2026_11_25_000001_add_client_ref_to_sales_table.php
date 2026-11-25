<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The till names each sale before it sends it (client_ref). When a reply is
 * lost — the connection drops, or the till stops waiting — the till sends the
 * same sale again, and the server answers with the sale it already saved
 * instead of saving a second one. Unique, so two copies arriving at the same
 * moment still make one sale. Null for sales from before this, and for any
 * client that doesn't send one.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->string('client_ref', 64)->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropUnique(['client_ref']);
            $table->dropColumn('client_ref');
        });
    }
};
