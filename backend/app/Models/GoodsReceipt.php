<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GoodsReceipt extends Model
{
    protected $fillable = [
        'reference', 'purchase_order_id', 'warehouse_id', 'received_by', 'received_date', 'notes',
    ];

    protected $casts = ['received_date' => 'date'];

    protected static function booted(): void
    {
        static::creating(function (GoodsReceipt $gr) {
            if (! $gr->reference) {
                $gr->reference = 'GR-' . strtoupper(uniqid());
            }
        });
    }

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function receiver(): BelongsTo { return $this->belongsTo(User::class, 'received_by'); }
    public function items(): HasMany { return $this->hasMany(GoodsReceiptItem::class); }
}
