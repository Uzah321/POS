<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class License extends Model
{
    protected $fillable = ['key', 'client_name', 'expires_at', 'status', 'notes', 'last_seen_at', 'last_seen_ip'];

    protected $casts = ['expires_at' => 'datetime', 'last_seen_at' => 'datetime'];

    public static function generateKey(): string
    {
        return implode('-', array_map(fn() => strtoupper(Str::random(5)), range(1, 4)));
    }

    /** Add whole months, starting from the later of now and the current expiry, so early renewals lose no days. */
    public function renew(int $months = 1): void
    {
        $base = $this->expires_at->isFuture() ? $this->expires_at : now();
        $this->update(['expires_at' => $base->copy()->addMonthsNoOverflow($months), 'status' => 'active']);
    }
}
