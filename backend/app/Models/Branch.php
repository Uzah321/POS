<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Branch extends Model
{
    protected $fillable = [
        'name', 'code', 'address', 'city', 'phone', 'email', 'currency', 'is_active', 'is_main',
    ];

    protected $casts = ['is_active' => 'boolean', 'is_main' => 'boolean'];

    public function users(): HasMany { return $this->hasMany(User::class); }
    public function warehouses(): HasMany { return $this->hasMany(Warehouse::class); }
    public function sales(): HasMany { return $this->hasMany(Sale::class); }
    public function expenses(): HasMany { return $this->hasMany(Expense::class); }
    public function purchaseOrders(): HasMany { return $this->hasMany(PurchaseOrder::class); }
}
