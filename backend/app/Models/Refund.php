<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Refund extends Model
{
    protected $fillable = ['reference', 'sale_id', 'user_id', 'amount', 'reason', 'status', 'completed_at'];
    protected $casts = ['amount' => 'decimal:2', 'completed_at' => 'datetime'];

    protected static function booted(): void
    {
        static::creating(function (Refund $r) {
            if (! $r->reference) $r->reference = 'REF-' . strtoupper(uniqid());
        });
    }

    public function sale(): BelongsTo { return $this->belongsTo(Sale::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function items(): HasMany { return $this->hasMany(RefundItem::class); }
}
