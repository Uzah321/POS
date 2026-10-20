<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The company logo is kept in settings as an image data URL. settings.value
 * is TEXT, which MySQL/MariaDB cap at 64 KB — too small for a picture.
 * Postgres and SQLite TEXT have no such limit.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }
        DB::statement('ALTER TABLE settings MODIFY value LONGTEXT NULL');
    }

    public function down(): void
    {
        // Narrowing back would truncate a stored logo — leave it wide.
    }
};
