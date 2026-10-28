<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Which station's printer gets this product's kitchen ticket. Null —
            // every existing product — means the default station, or with none
            // set, the till's own category rules, as before stations existed.
            $table->foreignId('kitchen_station_id')->nullable()->after('scale_id')
                ->constrained('kitchen_stations')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropConstrainedForeignId('kitchen_station_id');
        });
    }
};
