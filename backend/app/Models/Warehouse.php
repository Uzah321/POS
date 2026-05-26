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
}
