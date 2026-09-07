<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WeighingScale extends Model
{
    protected $fillable = ['name', 'mode', 'host', 'port', 'baud_rate', 'is_active'];

    protected $casts = [
        'port'      => 'integer',
        'baud_rate' => 'integer',
        'is_active' => 'boolean',
    ];

    public function products(): HasMany { return $this->hasMany(Product::class, 'scale_id'); }
    public function saleItems(): HasMany { return $this->hasMany(SaleItem::class, 'scale_id'); }
}
