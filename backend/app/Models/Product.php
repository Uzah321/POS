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
        'description', 'cost_price', 'selling_price', 'wholesale_price', 'image', 'color',
        'has_variants', 'track_stock', 'made_to_order', 'is_active', 'reorder_level', 'reorder_quantity',
        'expires', 'alert_quantity',
    ];

    protected $appends = ['total_stock', 'profit', 'profit_margin'];

    protected $casts = [
        'has_variants' => 'boolean',
        'track_stock' => 'boolean',
        'made_to_order' => 'boolean',
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
        // A made-to-order item (e.g. a pizza) never carries its own stock row — it's
        // assembled from its recipe when sold, so "how much is in stock" really means
        // "how many more can the current ingredient levels make."
        if ($this->made_to_order) {
            return $this->maxSellableFromIngredients();
        }
        // Use withSum result if already computed (no N+1)
        if (array_key_exists('stocks_sum_quantity', $this->attributes)) {
            return (float) ($this->attributes['stocks_sum_quantity'] ?? 0);
        }
        if ($this->relationLoaded('stocks')) {
            return (float) $this->stocks->sum('quantity');
        }
        return (float) $this->stocks()->sum('quantity');
    }

    /**
     * How many more units this recipe can currently make, i.e. the smallest
     * (ingredient stock ÷ quantity needed per unit) across every ingredient in the
     * recipe. A product flagged made_to_order with no recipe yet defined can't make
     * anything — 0, not "unlimited" — so it doesn't silently oversell during setup.
     */
    public function maxSellableFromIngredients(): float
    {
        $rows = $this->ingredients()->with(['ingredient' => fn ($q) => $q->withSum('stocks', 'quantity')])->get();
        if ($rows->isEmpty()) {
            return 0.0;
        }

        $max = null;
        foreach ($rows as $row) {
            $need = (float) $row->quantity;
            if ($need <= 0) continue;
            $have = (float) ($row->ingredient->total_stock ?? 0);
            $possible = floor($have / $need);
            $max = $max === null ? $possible : min($max, $possible);
        }

        return $max === null ? 0.0 : max(0.0, $max);
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
