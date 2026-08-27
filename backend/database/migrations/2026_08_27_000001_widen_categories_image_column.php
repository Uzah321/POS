<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Category tiles now store an uploaded photo the same way products do —
     * a base64 data URL directly in this column. The original `string`
     * column is a 255-char VARCHAR on MySQL/Postgres — far too small — so
     * widen it with raw SQL, same as 2026_07_17_000001 did for
     * products.image. SQLite has no column-length enforcement, so there is
     * nothing to do there.
     */
    public function up(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE categories MODIFY image LONGTEXT NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE categories ALTER COLUMN image TYPE TEXT');
        }
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE categories MODIFY image VARCHAR(255) NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE categories ALTER COLUMN image TYPE VARCHAR(255)');
        }
    }
};
