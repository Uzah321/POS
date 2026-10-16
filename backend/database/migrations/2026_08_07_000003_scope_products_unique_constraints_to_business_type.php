<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * sku/barcode were made unique per-branch back when a branch owned a
     * single shared catalog (see 2026_07_14_000002). Now that a branch's
     * catalog is itself split into restaurant/supermarket sides that don't
     * share products, the same SKU/barcode legitimately needs to exist once
     * per side — e.g. numbering restaurant items 1001+ and supermarket items
     * 1001+ independently. Widen the constraint to (branch_id, business_type,
     * sku/barcode) so one side no longer blocks the other.
     *
     * The new indexes go in before the old ones come out: on MySQL/MariaDB
     * an index starting with branch_id is what backs the branch_id foreign
     * key, so the last one can't be dropped until a replacement exists. Each
     * step is skipped if already done, so a database an earlier ordering of
     * this migration left halfway (MariaDB has no transactional DDL) picks
     * up where it stopped.
     */
    public function up(): void
    {
        $this->addUnique(['branch_id', 'business_type', 'sku'], 'products_branch_type_sku_unique');
        $this->addUnique(['branch_id', 'business_type', 'barcode'], 'products_branch_type_barcode_unique');
        $this->dropUnique('products_branch_sku_unique');
        $this->dropUnique('products_branch_barcode_unique');
    }

    public function down(): void
    {
        $this->addUnique(['branch_id', 'sku'], 'products_branch_sku_unique');
        $this->addUnique(['branch_id', 'barcode'], 'products_branch_barcode_unique');
        $this->dropUnique('products_branch_type_sku_unique');
        $this->dropUnique('products_branch_type_barcode_unique');
    }

    private function addUnique(array $columns, string $name): void
    {
        if (Schema::hasIndex('products', $name)) {
            return;
        }
        Schema::table('products', function (Blueprint $table) use ($columns, $name) {
            $table->unique($columns, $name);
        });
    }

    private function dropUnique(string $name): void
    {
        if (! Schema::hasIndex('products', $name)) {
            return;
        }
        Schema::table('products', function (Blueprint $table) use ($name) {
            $table->dropUnique($name);
        });
    }
};
