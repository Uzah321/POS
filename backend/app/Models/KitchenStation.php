<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class KitchenStation extends Model
{
    protected $fillable = ['name', 'is_default'];

    protected $casts = [
        'is_default' => 'boolean',
    ];

    public function products(): HasMany { return $this->hasMany(Product::class); }
}
