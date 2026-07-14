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
        'name', 'slug', 'sku', 'barcode', 'branch_id', 'category_id', 'brand_id', 'tax_rate_id', 'unit_id',
        'description', 'cost_price', 'selling_price', 'wholesale_price', 'image',
        'has_variants', 'track_stock', 'is_active', 'reorder_level', 'reorder_quantity',
        'expires', 'alert_quantity',
    ];

    protected $appends = ['total_stock', 'profit', 'profit_margin'];

    protected $casts = [
        'has_variants' => 'boolean',
        'track_stock' => 'boolean',
        'is_active' => 'boolean',
        'expires' => 'boolean',
        'cost_price' => 'decimal:2',
        'selling_price' => 'decimal:2',
        'wholesale_price' => 'decimal:2',
    ];

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function category(): BelongsTo { return $this->belongsTo(Category::class); }
    public function brand(): BelongsTo { return $this->belongsTo(Brand::class); }
    public function taxRate(): BelongsTo { return $this->belongsTo(TaxRate::class); }
    public function unit(): BelongsTo { return $this->belongsTo(Unit::class); }
    public function variants(): HasMany { return $this->hasMany(ProductVariant::class); }
    public function stocks(): HasMany { return $this->hasMany(Stock::class); }
    public function ingredients(): HasMany { return $this->hasMany(ProductIngredient::class); }

    /**
     * Recompute cost_price as the sum of each ingredient's quantity × its own cost_price.
     * Only touches the DB when the product actually has ingredients defined.
     */
    public function recalculateCostFromIngredients(): void
    {
        $rows = $this->ingredients()->with('ingredient:id,cost_price')->get();
        if ($rows->isEmpty()) {
            return;
        }
        $cost = $rows->sum(fn (ProductIngredient $row) => (float) $row->quantity * (float) ($row->ingredient->cost_price ?? 0));
        $this->update(['cost_price' => round($cost, 2)]);
    }

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

    public function getProfitAttribute(): float
    {
        return round((float) $this->selling_price - (float) $this->cost_price, 2);
    }

    public function getProfitMarginAttribute(): float
    {
        $selling = (float) $this->selling_price;
        return $selling > 0 ? round(($this->profit / $selling) * 100, 2) : 0.0;
    }
}
