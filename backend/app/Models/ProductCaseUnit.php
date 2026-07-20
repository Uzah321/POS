<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductCaseUnit extends Model
{
    protected $fillable = ['case_product_id', 'unit_product_id', 'units_per_case'];

    protected $casts = [
        'units_per_case' => 'decimal:3',
    ];

    public function caseProduct(): BelongsTo { return $this->belongsTo(Product::class, 'case_product_id'); }
    public function unitProduct(): BelongsTo { return $this->belongsTo(Product::class, 'unit_product_id'); }
}
