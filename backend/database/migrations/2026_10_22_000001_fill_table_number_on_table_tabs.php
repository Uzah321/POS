<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Tabs opened from a table were saved with its table_id but no table_number,
 * so Sales by Waiter counted 0 tables served and Sales by Table put them
 * under Walk-in. Copy each table's name onto its sales that lack one.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('restaurant_tables')->select('id', 'name')->orderBy('id')->each(function ($table) {
            DB::table('sales')
                ->where('table_id', $table->id)
                ->where(fn ($q) => $q->whereNull('table_number')->orWhere('table_number', ''))
                ->update(['table_number' => mb_substr($table->name, 0, 20)]);
        });
    }

    public function down(): void
    {
        // Which sales had no table number before can't be told apart afterwards.
    }
};
