<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockCountItem extends Model
{
    protected $fillable = ['stock_count_id', 'product_id', 'product_variant_id', 'system_quantity', 'counted_quantity', 'difference'];
    protected $casts = ['system_quantity' => 'decimal:3', 'counted_quantity' => 'decimal:3', 'difference' => 'decimal:3'];

    public function stockCount(): BelongsTo { return $this->belongsTo(StockCount::class); }
    public function product(): BelongsTo { return $this->belongsTo(Product::class); }
}
