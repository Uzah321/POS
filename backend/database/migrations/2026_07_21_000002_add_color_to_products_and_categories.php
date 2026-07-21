<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('color', 9)->nullable()->after('image');
        });
        Schema::table('categories', function (Blueprint $table) {
            $table->string('color', 9)->nullable()->after('image');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('color');
        });
        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('color');
        });
    }
};
