<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Rental extends Model
{
    protected $fillable = [
        'branch_id', 'created_by', 'property_name', 'property_type',
        'tenant_name', 'tenant_phone', 'tenant_email',
        'monthly_amount', 'currency', 'lease_start', 'lease_end',
        'flow_type', 'status', 'notes',
    ];

    protected $casts = [
        'monthly_amount' => 'decimal:2',
        'lease_start'    => 'date',
        'lease_end'      => 'date',
    ];

    public function branch()   { return $this->belongsTo(Branch::class); }
    public function creator()  { return $this->belongsTo(User::class, 'created_by'); }
    public function payments() { return $this->hasMany(RentalPayment::class); }
}
