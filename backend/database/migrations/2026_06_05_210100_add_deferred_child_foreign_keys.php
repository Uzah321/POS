<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->addCascadeForeignIfMissing('layby_payments', 'layby_id', 'laybys', 'layby_payments_layby_id_foreign');
        $this->addCascadeForeignIfMissing('quotation_items', 'quotation_id', 'quotations', 'quotation_items_quotation_id_foreign');
        $this->addCascadeForeignIfMissing('stock_transfer_items', 'stock_transfer_id', 'stock_transfers', 'stock_transfer_items_stock_transfer_id_foreign');
        $this->addCascadeForeignIfMissing('stocktake_items', 'stocktake_id', 'stocktakes', 'stocktake_items_stocktake_id_foreign');
    }

    public function down(): void
    {
        $this->dropForeignIfExists('stocktake_items', 'stocktake_items_stocktake_id_foreign');
        $this->dropForeignIfExists('stock_transfer_items', 'stock_transfer_items_stock_transfer_id_foreign');
        $this->dropForeignIfExists('quotation_items', 'quotation_items_quotation_id_foreign');
        $this->dropForeignIfExists('layby_payments', 'layby_payments_layby_id_foreign');
    }

    private function addCascadeForeignIfMissing(string $tableName, string $column, string $referencesTable, string $constraintName): void
    {
        if (! Schema::hasTable($tableName) || ! Schema::hasTable($referencesTable) || ! Schema::hasColumn($tableName, $column)) {
            return;
        }

        if ($this->foreignKeyExists($tableName, $constraintName)) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($column, $referencesTable) {
            $table->foreign($column)->references('id')->on($referencesTable)->cascadeOnDelete();
        });
    }

    private function dropForeignIfExists(string $tableName, string $constraintName): void
    {
        if (! Schema::hasTable($tableName) || ! $this->foreignKeyExists($tableName, $constraintName)) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($constraintName) {
            $table->dropForeign($constraintName);
        });
    }

    private function foreignKeyExists(string $tableName, string $constraintName): bool
    {
        return match (Schema::getConnection()->getDriverName()) {
            'pgsql' => (bool) DB::scalar(
                "select exists (
                    select 1
                    from pg_constraint c
                    join pg_class t on t.oid = c.conrelid
                    where c.conname = ?
                      and t.relname = ?
                )",
                [$constraintName, $tableName]
            ),
            'mysql', 'mariadb' => (bool) DB::scalar(
                "select exists (
                    select 1
                    from information_schema.table_constraints
                    where constraint_schema = database()
                      and table_name = ?
                      and constraint_name = ?
                      and constraint_type = 'FOREIGN KEY'
                )",
                [$tableName, $constraintName]
            ),
            default => false,
        };
    }
};