<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('licenses', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique();
            $table->string('client_name');
            $table->timestamp('expires_at');
            $table->string('status', 20)->default('active'); // active | revoked
            $table->text('notes')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->string('last_seen_ip', 45)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('licenses');
    }
};
