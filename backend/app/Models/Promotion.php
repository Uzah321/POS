<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;

class Promotion extends Model
{
    protected $fillable = [
        'name', 'code', 'type', 'value', 'minimum_purchase', 'maximum_discount',
        'usage_limit', 'usage_count', 'is_active', 'starts_at', 'expires_at',
    ];
    protected $casts = [
        'is_active' => 'boolean',
        'starts_at' => 'date',
        'expires_at' => 'date',
        'value' => 'decimal:2',
        'minimum_purchase' => 'decimal:2',
        'maximum_discount' => 'decimal:2',
    ];
}
