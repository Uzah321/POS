<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SaleItem extends Model
{
    protected $fillable = [
        'sale_id', 'product_id', 'product_variant_id', 'scale_id', 'quantity', 'unit_price',
        'cost_price', 'discount_amount', 'tax_amount', 'subtotal', 'total',
        'discount_type', 'discount_value', 'note',
    ];

    protected $casts = [
        'quantity' => 'decimal:3',
        'unit_price' => 'decimal:6',
        'cost_price' => 'decimal:6',
        'discount_amount' => 'decimal:6',
        'tax_amount' => 'decimal:6',
        'subtotal' => 'decimal:6',
        'total' => 'decimal:6',
        'discount_value' => 'decimal:6',
    ];

    public function sale(): BelongsTo { return $this->belongsTo(Sale::class); }
    public function product(): BelongsTo { return $this->belongsTo(Product::class); }
    public function variant(): BelongsTo { return $this->belongsTo(ProductVariant::class, 'product_variant_id'); }
    public function scale(): BelongsTo { return $this->belongsTo(WeighingScale::class, 'scale_id'); }
}
