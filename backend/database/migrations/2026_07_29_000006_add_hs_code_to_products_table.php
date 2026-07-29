<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // National Harmonized System code, required by ZIMRA only for VAT
            // payers (RCPT047/048). Left optional here — a missing code is sent
            // as-is rather than blocking the sale, since forcing every product to
            // be recoded before go-live would break usability for large catalogs.
            $table->string('hs_code', 8)->nullable()->after('barcode');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('hs_code');
        });
    }
};
