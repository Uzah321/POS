<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SupplierPayment extends Model
{
    protected $fillable = [
        'reference', 'supplier_id', 'purchase_order_id', 'user_id',
        'amount', 'method', 'payment_date', 'notes',
    ];
    protected $casts = ['payment_date' => 'date', 'amount' => 'decimal:2'];

    protected static function booted(): void
    {
        static::creating(function (SupplierPayment $p) {
            if (! $p->reference) $p->reference = 'SP-' . strtoupper(uniqid());
        });
    }

    public function supplier(): BelongsTo { return $this->belongsTo(Supplier::class); }
    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
