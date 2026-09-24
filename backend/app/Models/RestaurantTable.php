<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RestaurantTable extends Model
{
    protected $fillable = ['branch_id', 'name', 'seats', 'is_active', 'sort_order'];

    protected $casts = [
        'is_active' => 'boolean',
        'seats' => 'integer',
        'sort_order' => 'integer',
    ];

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function sales(): HasMany { return $this->hasMany(Sale::class, 'table_id'); }
}
