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
        $this->allowStatuses(['draft', 'open', 'completed', 'refunded', 'partially_refunded', 'voided']);
    }

    public function down(): void
    {
        $this->allowStatuses(['draft', 'completed', 'refunded', 'partially_refunded', 'voided']);
    }

    // The enum column comes out differently per database: PostgreSQL (the
    // online server) gets a varchar guarded by a sales_status_check
    // constraint, MySQL/MariaDB (the offline desktop install) a native ENUM.
    private function allowStatuses(array $statuses): void
    {
        $list = "'" . implode("','", $statuses) . "'";

        switch (DB::getDriverName()) {
            case 'pgsql':
                DB::statement('ALTER TABLE sales DROP CONSTRAINT sales_status_check');
                DB::statement("ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ($list))");
                break;
            case 'mysql':
            case 'mariadb':
                DB::statement("ALTER TABLE sales MODIFY status ENUM($list) NOT NULL DEFAULT 'draft'");
                break;
            // SQLite (the test suite) builds the column with an inline CHECK
            // that can't be altered in place — left as it is.
        }
    }
};
