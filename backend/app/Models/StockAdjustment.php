<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockAdjustment extends Model
{
    protected $fillable = ['reference', 'warehouse_id', 'user_id', 'type', 'reason'];

    protected static function booted(): void
    {
        static::creating(fn($m) => $m->reference ??= 'ADJ-' . strtoupper(uniqid()));
    }

    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function items(): HasMany { return $this->hasMany(StockAdjustmentItem::class); }
}
