<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ProductVariant extends Model
{
    protected $fillable = [
        'product_id', 'name', 'sku', 'barcode', 'cost_price', 'selling_price', 'attributes', 'is_active',
    ];

    protected $casts = [
        'attributes' => 'array',
        'is_active' => 'boolean',
        'cost_price' => 'decimal:2',
        'selling_price' => 'decimal:2',
    ];

    public function product(): BelongsTo { return $this->belongsTo(Product::class); }
    public function stocks(): HasMany { return $this->hasMany(Stock::class); }
}
