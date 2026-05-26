<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Currency extends Model
{
    protected $fillable = [
        'code', 'name', 'symbol', 'exchange_rate', 'is_default', 'is_active',
    ];

    protected $casts = [
        'exchange_rate' => 'decimal:6',
        'is_default'    => 'boolean',
        'is_active'     => 'boolean',
    ];

    /** Convert an amount from this currency to USD */
    public function toUsd(float $amount): float
    {
        return $amount / $this->exchange_rate;
    }

    /** Convert an amount from USD to this currency */
    public function fromUsd(float $usd): float
    {
        return $usd * $this->exchange_rate;
    }

    public static function default(): self
    {
        return static::where('is_default', true)->first()
            ?? static::where('code', 'USD')->first();
    }
}
