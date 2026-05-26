<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HeldSale extends Model
{
    protected $table = 'held_sales';

    protected $fillable = ['reference', 'branch_id', 'user_id', 'customer_id', 'cart_data', 'note', 'order_status', 'table_number'];

    protected $casts = ['cart_data' => 'array'];

    protected static function booted(): void
    {
        static::creating(function (HeldSale $h) {
            if (! $h->reference) $h->reference = 'HOLD-' . strtoupper(uniqid());
        });
    }

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function customer(): BelongsTo { return $this->belongsTo(Customer::class); }
}
