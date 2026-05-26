<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockCount extends Model
{
    protected $fillable = ['reference', 'warehouse_id', 'created_by', 'status', 'notes', 'completed_at'];
    protected $casts = ['completed_at' => 'datetime'];

    protected static function booted(): void
    {
        static::creating(fn($m) => $m->reference ??= 'CNT-' . strtoupper(uniqid()));
    }

    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function items(): HasMany { return $this->hasMany(StockCountItem::class); }
}
