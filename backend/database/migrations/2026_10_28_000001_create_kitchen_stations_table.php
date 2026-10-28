<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('kitchen_stations', function (Blueprint $table) {
            $table->id();
            // Where a restaurant's order tickets print — "Grill", "Bar", "Pizza",
            // "Main Kitchen". A role, not a device: each till chooses which of its
            // own printers prints each station (Hardware → Kitchen Printer), so one
            // list serves every till and branch. The default station takes the
            // products that don't name one.
            $table->string('name', 100)->unique();
            $table->boolean('is_default')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kitchen_stations');
    }
};
