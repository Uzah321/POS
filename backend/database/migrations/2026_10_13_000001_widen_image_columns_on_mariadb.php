<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Catch-up for offline (MariaDB) installs: the 2026_07_17 / 2026_08_27
 * migrations that widen products.image / categories.image only checked for
 * the 'mysql' driver, and the desktop install connects as 'mariadb' — so
 * there they ran as no-ops and left both columns at VARCHAR(255), too small
 * for a picture. Those migrations now cover MariaDB too, but databases that
 * already recorded them as run need widening here. Re-applying LONGTEXT to a
 * column that already has it changes nothing; Postgres was never affected.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }
        DB::statement('ALTER TABLE products MODIFY image LONGTEXT NULL');
        DB::statement('ALTER TABLE categories MODIFY image LONGTEXT NULL');
    }

    public function down(): void
    {
        // Narrowing back would truncate stored pictures — leave them wide.
    }
};
