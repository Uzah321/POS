<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Ingredient extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name', 'sku', 'barcode', 'unit_id', 'conversion_number', 'stock_unit',
        'cost_price', 'is_active',
    ];

    protected $appends = ['total_stock'];

    protected $casts = [
        'is_active' => 'boolean',
        'cost_price' => 'decimal:2',
        'conversion_number' => 'decimal:3',
    ];

    public function unit(): BelongsTo { return $this->belongsTo(Unit::class); }
    public function stocks(): HasMany { return $this->hasMany(IngredientStock::class); }
    public function vendors(): HasMany { return $this->hasMany(IngredientVendor::class); }
    public function branchSettings(): HasMany { return $this->hasMany(IngredientBranchSetting::class); }

    public function getTotalStockAttribute(): float
    {
        if (array_key_exists('stocks_sum_quantity', $this->attributes)) {
            return (float) ($this->attributes['stocks_sum_quantity'] ?? 0);
        }
        if ($this->relationLoaded('stocks')) {
            return (float) $this->stocks->sum('quantity');
        }
        return (float) $this->stocks()->sum('quantity');
    }
}
