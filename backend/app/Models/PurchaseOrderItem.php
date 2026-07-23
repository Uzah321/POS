<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PurchaseOrderItem extends Model
{
    protected $fillable = [
        'purchase_order_id', 'product_id', 'product_variant_id',
        'quantity', 'received_quantity', 'unit_cost', 'tax_amount', 'subtotal',
    ];

    protected $casts = [
        'quantity' => 'decimal:3',
        'received_quantity' => 'decimal:3',
        'unit_cost' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'subtotal' => 'decimal:2',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class); }
    // withTrashed() — a PO is a historical record; it should still show what was
    // actually ordered even if that product has since been deleted from the catalog.
    public function product(): BelongsTo { return $this->belongsTo(Product::class)->withTrashed(); }
    public function variant(): BelongsTo { return $this->belongsTo(ProductVariant::class, 'product_variant_id'); }
}
