<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockAdjustmentItem extends Model
{
    protected $fillable = ['stock_adjustment_id', 'product_id', 'product_variant_id', 'quantity_before', 'quantity_adjusted', 'quantity_after', 'cost_price'];
    protected $casts = ['quantity_before' => 'decimal:3', 'quantity_adjusted' => 'decimal:3', 'quantity_after' => 'decimal:3', 'cost_price' => 'decimal:2'];

    public function adjustment(): BelongsTo { return $this->belongsTo(StockAdjustment::class, 'stock_adjustment_id'); }
    public function product(): BelongsTo { return $this->belongsTo(Product::class); }
}
