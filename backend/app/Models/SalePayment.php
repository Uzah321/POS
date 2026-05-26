<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SalePayment extends Model
{
    protected $fillable = ['sale_id', 'method', 'amount', 'reference', 'note'];
    protected $casts = ['amount' => 'decimal:2'];

    public function sale(): BelongsTo { return $this->belongsTo(Sale::class); }
}
