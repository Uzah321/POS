<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Stock extends Model
{
    protected $fillable = [
        'product_id', 'product_variant_id', 'warehouse_id', 'quantity', 'batch_number', 'expiry_date',
    ];

    protected $casts = [
        'quantity' => 'decimal:3',
        'expiry_date' => 'date',
    ];

    public function product(): BelongsTo { return $this->belongsTo(Product::class); }
    public function variant(): BelongsTo { return $this->belongsTo(ProductVariant::class, 'product_variant_id'); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
}
