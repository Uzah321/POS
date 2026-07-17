<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * The product Recipe tab stores item photos as a compressed base64 data
     * URL directly in this column (no filesystem/symlink dependency, works
     * identically in the offline desktop build). The original `string`
     * column is a 255-char VARCHAR on MySQL/Postgres — far too small — so
     * widen it with raw SQL to avoid requiring doctrine/dbal just for a
     * column-type change. SQLite has no column-length enforcement, so there
     * is nothing to do there.
     */
    public function up(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE products MODIFY image LONGTEXT NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE products ALTER COLUMN image TYPE TEXT');
        }
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE products MODIFY image VARCHAR(255) NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE products ALTER COLUMN image TYPE VARCHAR(255)');
        }
    }
};
