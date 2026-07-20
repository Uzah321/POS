<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IngredientVendor extends Model
{
    protected $fillable = ['ingredient_id', 'supplier_id', 'vendor_sku', 'vendor_cost'];

    protected $casts = [
        'vendor_cost' => 'decimal:2',
    ];

    public function ingredient(): BelongsTo { return $this->belongsTo(Ingredient::class); }
    public function supplier(): BelongsTo { return $this->belongsTo(Supplier::class); }
}
