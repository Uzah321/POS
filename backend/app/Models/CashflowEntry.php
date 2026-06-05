<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CashflowEntry extends Model
{
    protected $fillable = [
        'reference', 'branch_id', 'user_id', 'flow_type', 'category',
        'description', 'amount', 'currency', 'entry_date', 'payment_method', 'notes',
    ];

    protected $casts = [
        'amount'     => 'decimal:2',
        'entry_date' => 'date',
    ];

    public function branch() { return $this->belongsTo(Branch::class); }
    public function user()   { return $this->belongsTo(User::class); }
}
