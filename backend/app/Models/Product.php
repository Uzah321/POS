<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Product extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name', 'slug', 'sku', 'barcode', 'category_id', 'brand_id', 'tax_rate_id', 'unit_id',
        'description', 'cost_price', 'selling_price', 'wholesale_price', 'image',
        'has_variants', 'track_stock', 'is_active', 'reorder_level', 'reorder_quantity',
        'expires', 'alert_quantity',
    ];

    protected $appends = ['total_stock'];

    protected $casts = [
        'has_variants' => 'boolean',
        'track_stock' => 'boolean',
        'is_active' => 'boolean',
        'expires' => 'boolean',
        'cost_price' => 'decimal:2',
        'selling_price' => 'decimal:2',
        'wholesale_price' => 'decimal:2',
    ];

    public function category(): BelongsTo { return $this->belongsTo(Category::class); }
    public function brand(): BelongsTo { return $this->belongsTo(Brand::class); }
    public function taxRate(): BelongsTo { return $this->belongsTo(TaxRate::class); }
    public function unit(): BelongsTo { return $this->belongsTo(Unit::class); }
    public function variants(): HasMany { return $this->hasMany(ProductVariant::class); }
    public function stocks(): HasMany { return $this->hasMany(Stock::class); }

    public function getTotalStockAttribute(): float
    {
        // Use withSum result if already computed (no N+1)
        if (array_key_exists('stocks_sum_quantity', $this->attributes)) {
            return (float) ($this->attributes['stocks_sum_quantity'] ?? 0);
        }
        if ($this->relationLoaded('stocks')) {
            return (float) $this->stocks->sum('quantity');
        }
        return (float) $this->stocks()->sum('quantity');
    }
}
