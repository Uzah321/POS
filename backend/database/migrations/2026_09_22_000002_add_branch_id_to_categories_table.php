<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->foreignId('branch_id')->nullable()->after('id')->constrained('branches')->nullOnDelete();
        });

        // Every category created before this migration belonged to the single
        // shared catalog — attach them all to the first branch so nothing that
        // already exists silently disappears from every branch's view.
        $firstBranchId = DB::table('branches')->orderBy('id')->value('id');
        if ($firstBranchId) {
            DB::table('categories')->whereNull('branch_id')->update(['branch_id' => $firstBranchId]);
        }
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
    }
};
