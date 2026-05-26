<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockTransferItem extends Model
{
    protected $fillable = ['stock_transfer_id', 'product_id', 'product_variant_id', 'quantity', 'received_quantity'];
    protected $casts = ['quantity' => 'decimal:3', 'received_quantity' => 'decimal:3'];

    public function transfer(): BelongsTo { return $this->belongsTo(StockTransfer::class, 'stock_transfer_id'); }
    public function product(): BelongsTo { return $this->belongsTo(Product::class); }
}
