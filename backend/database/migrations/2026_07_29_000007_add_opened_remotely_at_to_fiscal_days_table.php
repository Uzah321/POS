<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('fiscal_days', function (Blueprint $table) {
            // A fiscal day can be opened locally (assigning fiscal_day_no) before
            // ZIMRA's openDay call actually succeeds — per §2.2, opening can be
            // delayed while offline, but must reach ZIMRA before any receipt does.
            // Null here means "still needs to be sent" and blocks receipt submission.
            $table->timestamp('opened_remotely_at')->nullable()->after('opened_at');
        });
    }

    public function down(): void
    {
        Schema::table('fiscal_days', function (Blueprint $table) {
            $table->dropColumn('opened_remotely_at');
        });
    }
};
