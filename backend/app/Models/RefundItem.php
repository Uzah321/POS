<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RefundItem extends Model
{
    protected $fillable = ['refund_id', 'sale_item_id', 'quantity', 'amount', 'restock'];
    protected $casts = ['quantity' => 'decimal:3', 'amount' => 'decimal:2', 'restock' => 'boolean'];

    public function refund(): BelongsTo { return $this->belongsTo(Refund::class); }
    public function saleItem(): BelongsTo { return $this->belongsTo(SaleItem::class); }
}
