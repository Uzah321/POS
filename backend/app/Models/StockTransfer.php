<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockTransfer extends Model
{
    protected $fillable = [
        'reference', 'from_warehouse_id', 'to_warehouse_id', 'created_by', 'approved_by',
        'status', 'transfer_date', 'notes', 'approved_at', 'received_at',
    ];
    protected $casts = ['transfer_date' => 'date', 'approved_at' => 'datetime', 'received_at' => 'datetime'];

    protected static function booted(): void
    {
        static::creating(function (StockTransfer $t) {
            if (! $t->reference) $t->reference = 'TRF-' . strtoupper(uniqid());
        });
    }

    public function fromWarehouse(): BelongsTo { return $this->belongsTo(Warehouse::class, 'from_warehouse_id'); }
    public function toWarehouse(): BelongsTo { return $this->belongsTo(Warehouse::class, 'to_warehouse_id'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function items(): HasMany { return $this->hasMany(StockTransferItem::class); }
}
