<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Artisan;

/**
 * One-time: give audit log entries written before detailed logging the same
 * product names/quantities new entries get. See BackfillAuditDetails.
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
