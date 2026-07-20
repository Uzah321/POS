<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Ingredients are raw materials consumed by recipes — a single shared
        // catalog across every branch/store (unlike Products, which each branch
        // owns its own copy of), matching how a real supply chain works: the
        // same "Flour" is the same raw material no matter which store's recipe
        // uses it. Per-store behaviour (stock levels, reorder targets) lives in
        // the related tables below instead of on this row.
        Schema::create('ingredients', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('sku')->nullable()->index();
            $table->string('barcode')->nullable()->index();
            $table->foreignId('unit_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('conversion_number', 12, 3)->nullable();
            $table->string('stock_unit')->nullable();
            $table->decimal('cost_price', 15, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();
        });

        // Stock on hand per warehouse — mirrors the `stocks` table used for Products.
        Schema::create('ingredient_stocks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ingredient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('warehouse_id')->constrained()->cascadeOnDelete();
            $table->decimal('quantity', 15, 3)->default(0);
            $table->timestamps();
            $table->unique(['ingredient_id', 'warehouse_id']);
        });

        // Vendors tab — which suppliers carry this ingredient, and at what
        // vendor-specific SKU/cost.
        Schema::create('ingredient_vendors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ingredient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('supplier_id')->constrained()->cascadeOnDelete();
            $table->string('vendor_sku')->nullable();
            $table->decimal('vendor_cost', 15, 2)->nullable();
            $table->timestamps();
            $table->unique(['ingredient_id', 'supplier_id']);
        });

        // Ordering tab — per-store recommended/minimum reorder quantities.
        Schema::create('ingredient_branch_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ingredient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $table->integer('recommended_quantity')->default(0);
            $table->integer('minimum_quantity')->default(0);
            $table->timestamps();
            $table->unique(['ingredient_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_branch_settings');
        Schema::dropIfExists('ingredient_vendors');
        Schema::dropIfExists('ingredient_stocks');
        Schema::dropIfExists('ingredients');
    }
};
