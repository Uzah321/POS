<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    /**
     * Mirrors the categories backfill (2026_08_06_000003) — every product
     * that existed before per-product business types were introduced is
     * still sitting at the 'both' default. Move that untouched backlog onto
     * the supermarket side, consistent with the categories they already
     * belong to. Only rows still at 'both' are touched.
     */
    public function up(): void
    {
        DB::table('products')->where('business_type', 'both')->update(['business_type' => 'supermarket']);
    }

    public function down(): void
    {
        // Not reversible — see the matching categories backfill migration.
    }
};
