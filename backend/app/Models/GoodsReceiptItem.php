<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GoodsReceiptItem extends Model
{
    protected $fillable = [
        'goods_receipt_id', 'purchase_order_item_id', 'product_id', 'product_variant_id',
        'quantity', 'unit_cost', 'batch_number', 'expiry_date',
    ];
    protected $casts = ['expiry_date' => 'date', 'quantity' => 'decimal:3', 'unit_cost' => 'decimal:2'];

    public function goodsReceipt(): BelongsTo { return $this->belongsTo(GoodsReceipt::class); }
    // withTrashed() — same reasoning as PurchaseOrderItem::product(): a goods
    // receipt is a historical record of what actually arrived.
    public function product(): BelongsTo { return $this->belongsTo(Product::class)->withTrashed(); }
    public function variant(): BelongsTo { return $this->belongsTo(ProductVariant::class, 'product_variant_id'); }
}
