<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('weighing_scales', function (Blueprint $table) {
            $table->id();
            // Each registered scale is its own device — a name like "Meat Scale" or
            // "Deli Scale" so staff can tell them apart, and the connection details
            // the till needs to reach it. 'network' scales are addressed by IP/port;
            // 'webserial' scales are physically wired into whichever till has them
            // plugged in, so host/port stay null and only baud_rate applies.
            $table->string('name');
            $table->enum('mode', ['network', 'webserial'])->default('network');
            $table->string('host')->nullable();
            $table->unsignedInteger('port')->nullable();
            $table->unsignedInteger('baud_rate')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('weighing_scales');
    }
};
