<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IngredientStock extends Model
{
    protected $fillable = ['ingredient_id', 'warehouse_id', 'quantity'];

    protected $casts = [
        'quantity' => 'decimal:3',
    ];

    public function ingredient(): BelongsTo { return $this->belongsTo(Ingredient::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
}
