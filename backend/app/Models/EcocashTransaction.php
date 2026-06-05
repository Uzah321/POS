<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EcocashTransaction extends Model
{
    protected $fillable = [
        'reference', 'branch_id', 'user_id', 'type', 'ecocash_reference',
        'customer_phone', 'amount', 'commission_rate', 'commission_amount',
        'float_before', 'float_after', 'transaction_date', 'notes', 'status',
    ];

    protected $casts = [
        'amount'            => 'decimal:2',
        'commission_rate'   => 'decimal:2',
        'commission_amount' => 'decimal:2',
        'float_before'      => 'decimal:2',
        'float_after'       => 'decimal:2',
        'transaction_date'  => 'date',
    ];

    public function branch()  { return $this->belongsTo(Branch::class); }
    public function user()    { return $this->belongsTo(User::class); }
}
