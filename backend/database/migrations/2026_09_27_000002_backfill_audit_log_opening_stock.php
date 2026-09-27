<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Artisan;

/**
 * One-time, second pass: add opening stock to older "Product created" entries (and anything else
 * new detail covers). Idempotent — see BackfillAuditDetails.
 */
return new class extends Migration
{
    public function up(): void
    {
        Artisan::call('audit:backfill-details');
    }

    public function down(): void
    {
        // The added detail is harmless to keep.
    }
};
