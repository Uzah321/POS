<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // A register is a single till/terminal within a branch. ZIMRA requires each
        // concurrently-operating till to be its own fiscal device with independently
        // sequential receipt numbers, so this sits below Branch as the unit a
        // fiscal_device attaches to (see fiscal_devices migration).
        Schema::create('registers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Nullable — a sale/refund only carries a register when the branch has
        // fiscalisation set up; existing/non-fiscalising installs are unaffected.
        Schema::table('sales', function (Blueprint $table) {
            $table->foreignId('register_id')->nullable()->after('warehouse_id')->constrained()->nullOnDelete();
        });
        Schema::table('refunds', function (Blueprint $table) {
            $table->foreignId('register_id')->nullable()->after('sale_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('refunds', function (Blueprint $table) {
            $table->dropConstrainedForeignId('register_id');
        });
        Schema::table('sales', function (Blueprint $table) {
            $table->dropConstrainedForeignId('register_id');
        });
        Schema::dropIfExists('registers');
    }
};
