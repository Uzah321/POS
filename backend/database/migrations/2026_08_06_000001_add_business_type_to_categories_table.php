<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // 'both' keeps every existing category visible in both modes on
        // upgrade — nothing disappears until an admin explicitly tags a
        // category as restaurant-only or supermarket-only.
        Schema::table('categories', function (Blueprint $table) {
            $table->enum('business_type', ['restaurant', 'supermarket', 'both'])->default('both')->after('color');
        });
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('business_type');
        });
    }
};
