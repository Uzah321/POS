<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    /**
     * Every category that existed before per-category business types were
     * introduced is still sitting at the 'both' default — none of them have
     * been manually retagged yet. Move that untouched backlog onto the
     * supermarket side and leave the restaurant catalog empty, so an admin
     * builds up the restaurant menu from scratch instead of inheriting
     * supermarket categories by default. Only rows still at 'both' are
     * touched — anything an admin has already retagged is left alone.
     */
    public function up(): void
    {
        DB::table('categories')->where('business_type', 'both')->update(['business_type' => 'supermarket']);
    }

    public function down(): void
    {
        // Not reversible in a meaningful way — we can't tell which rows were
        // touched by up() apart from ones an admin later tagged 'supermarket'
        // themselves. Intentionally a no-op.
    }
};
