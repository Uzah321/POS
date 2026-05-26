<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseOrder extends Model
{
    protected $fillable = [
        'reference', 'supplier_id', 'branch_id', 'warehouse_id', 'created_by', 'approved_by',
        'status', 'order_date', 'expected_date', 'subtotal', 'tax_amount', 'discount_amount',
        'total', 'amount_paid', 'notes', 'approved_at',
    ];

    protected $casts = [
        'order_date' => 'date',
        'expected_date' => 'date',
        'approved_at' => 'datetime',
        'subtotal' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'total' => 'decimal:2',
        'amount_paid' => 'decimal:2',
    ];

    protected static function booted(): void
    {
        static::creating(function (PurchaseOrder $po) {
            if (! $po->reference) {
                $po->reference = 'PO-' . strtoupper(uniqid());
            }
        });
    }

    public function supplier(): BelongsTo { return $this->belongsTo(Supplier::class); }
    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function approver(): BelongsTo { return $this->belongsTo(User::class, 'approved_by'); }
    public function items(): HasMany { return $this->hasMany(PurchaseOrderItem::class); }
    public function goodsReceipts(): HasMany { return $this->hasMany(GoodsReceipt::class); }
}
