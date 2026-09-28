<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Paid salaries and rent paid are now deducted from sales alongside
        // expenses, so a closed day keeps what it deducted for each.
        Schema::table('end_of_day', function (Blueprint $table) {
            $table->decimal('total_salaries', 15, 2)->default(0)->after('total_expenses');
            $table->decimal('total_rent_paid', 15, 2)->default(0)->after('total_salaries');
        });
    }

    public function down(): void
    {
        Schema::table('end_of_day', function (Blueprint $table) {
            $table->dropColumn(['total_salaries', 'total_rent_paid']);
        });
    }
};
