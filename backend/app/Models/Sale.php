<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Sale extends Model
{
    use SoftDeletes;

    /**
     * Statuses that represent a real, finalized transaction for revenue/
     * transaction-count reporting — a sale keeps counting even after a later
     * (partial) refund, since the transaction did happen and sales.total is
     * never reduced by a refund (refunds are reported as their own separate
     * line, never netted out). Only 'draft' (never finalized) and 'voided'
     * (cancelled before/without a real transaction) are excluded. Every
     * report that aggregates sales revenue/transactions must use this same
     * set — otherwise a refunded sale silently vanishes from reports like
     * Cashier Performance while still showing (at full value) on Sales
     * History / My Sales, which never filter by status.
     */
    const REVENUE_STATUSES = ['completed', 'refunded', 'partially_refunded'];

    protected $fillable = [
        'reference', 'branch_id', 'warehouse_id', 'customer_id', 'user_id', 'status', 'kds_status',
        'subtotal', 'discount_amount', 'tax_amount', 'total', 'amount_paid', 'change_due',
        'discount_type', 'discount_value', 'coupon_code', 'notes', 'is_offline', 'completed_at',
        'table_number', 'order_type',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'total' => 'decimal:2',
        'amount_paid' => 'decimal:2',
        'change_due' => 'decimal:2',
        'discount_value' => 'decimal:2',
        'is_offline' => 'boolean',
        'completed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (Sale $sale) {
            if (! $sale->reference) {
                $sale->reference = 'SALE-' . strtoupper(uniqid());
            }
        });
    }

    /** Sales that count toward revenue/transaction reporting — see REVENUE_STATUSES. */
    public function scopeRevenueCounted($query)
    {
        return $query->whereIn('status', self::REVENUE_STATUSES);
    }

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function customer(): BelongsTo { return $this->belongsTo(Customer::class); }
    public function cashier(): BelongsTo { return $this->belongsTo(User::class, 'user_id'); }
    public function items(): HasMany { return $this->hasMany(SaleItem::class); }
    public function payments(): HasMany { return $this->hasMany(SalePayment::class); }
    public function refunds(): HasMany { return $this->hasMany(Refund::class); }
}
