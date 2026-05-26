<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Supplier extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name', 'company_name', 'email', 'phone', 'address', 'city', 'country',
        'vat_number', 'account_number', 'balance', 'credit_limit', 'is_active', 'notes',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'balance' => 'decimal:2',
        'credit_limit' => 'decimal:2',
    ];

    public function purchaseOrders(): HasMany { return $this->hasMany(PurchaseOrder::class); }
    public function payments(): HasMany { return $this->hasMany(SupplierPayment::class); }
}
