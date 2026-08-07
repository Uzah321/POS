<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Products previously relied entirely on their category's business_type,
     * falling back to "visible in both modes" whenever a product had no
     * category assigned. That fallback is what let a restaurant-mode product
     * with no category leak into the supermarket catalog. Products now carry
     * their own tag — set explicitly at creation time from whichever mode is
     * active — so visibility no longer depends on category assignment at all.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->enum('business_type', ['restaurant', 'supermarket', 'both'])->default('both')->after('category_id');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('business_type');
        });
    }
};
