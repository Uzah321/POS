<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Customer extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name', 'email', 'phone', 'address', 'city', 'id_number',
        'balance', 'credit_limit', 'loyalty_points', 'is_active', 'notes',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'balance' => 'decimal:2',
        'credit_limit' => 'decimal:2',
        'loyalty_points' => 'integer',
    ];

    public function sales(): HasMany { return $this->hasMany(Sale::class); }
    public function loyaltyTransactions(): HasMany { return $this->hasMany(LoyaltyTransaction::class); }
    public function creditTransactions(): HasMany { return $this->hasMany(CustomerCreditTransaction::class); }
}
