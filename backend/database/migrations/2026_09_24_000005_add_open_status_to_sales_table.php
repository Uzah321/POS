<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 'open' represents a committed-but-unpaid tab: items are entered, sent
        // to the kitchen and stock is deducted, but no payment has been taken
        // yet. Distinct from 'draft' (unused today) and from held_sales, which
        // is a lighter "not yet decided" park that never touches stock.
        DB::statement("ALTER TABLE sales DROP CONSTRAINT sales_status_check");
        DB::statement("ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('draft','open','completed','refunded','partially_refunded','voided'))");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE sales DROP CONSTRAINT sales_status_check");
        DB::statement("ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('draft','completed','refunded','partially_refunded','voided'))");
    }
};
