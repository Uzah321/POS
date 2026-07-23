<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IngredientStockAdjustment extends Model
{
    protected $fillable = [
        'reference', 'ingredient_id', 'warehouse_id', 'user_id', 'type', 'reason',
        'quantity_before', 'quantity_adjusted', 'quantity_after',
    ];

    protected $casts = [
        'quantity_before'   => 'decimal:3',
        'quantity_adjusted' => 'decimal:3',
        'quantity_after'    => 'decimal:3',
    ];

    protected static function booted(): void
    {
        static::creating(fn ($m) => $m->reference ??= 'IADJ-' . strtoupper(uniqid()));
    }

    public function ingredient(): BelongsTo { return $this->belongsTo(Ingredient::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
