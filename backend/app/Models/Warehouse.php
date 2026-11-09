<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Warehouse extends Model
{
    protected $fillable = ['name', 'code', 'branch_id', 'address', 'is_active', 'is_default'];
    protected $casts = ['is_active' => 'boolean', 'is_default' => 'boolean'];

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function stocks(): HasMany { return $this->hasMany(Stock::class); }
    public function transfers(): HasMany { return $this->hasMany(StockTransfer::class, 'from_warehouse_id'); }

    /**
     * The warehouse a branch sells from: its default, else its first — the
     * same one SaleController::saleWarehouseId() takes a sale's stock out of.
     * Falls back to the store-wide default when the branch has none.
     */
    public static function defaultForBranch(?int $branchId): ?self
    {
        return ($branchId ? static::where('branch_id', $branchId)->orderByDesc('is_default')->orderBy('id')->first() : null)
            ?? static::where('is_default', true)->orderBy('id')->first()
            ?? static::orderBy('id')->first();
    }

    /** A branch's warehouse ids, or null (every warehouse) when no branch is given or it has none of its own. */
    public static function idsForBranch(?int $branchId): ?array
    {
        if (! $branchId) {
            return null;
        }
        $ids = static::where('branch_id', $branchId)->pluck('id')->all();
        return $ids ?: null;
    }
}
