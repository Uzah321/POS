<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Which shop this user works in: 'restaurant' or 'supermarket'. Null keeps the
            // old behaviour (follow the system-wide mode), so existing users are unaffected.
            $table->string('business_type', 20)->nullable()->after('department_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('business_type');
        });
    }
};
