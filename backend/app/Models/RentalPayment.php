<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RentalPayment extends Model
{
    protected $fillable = [
        'reference', 'rental_id', 'recorded_by', 'period',
        'amount', 'payment_date', 'payment_method', 'notes',
    ];

    protected $casts = [
        'amount'       => 'decimal:2',
        'payment_date' => 'date',
    ];

    public function rental()     { return $this->belongsTo(Rental::class); }
    public function recordedBy() { return $this->belongsTo(User::class, 'recorded_by'); }
}
