<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShiftEnd extends Model
{
    protected $table = 'shift_ends';

    protected $fillable = [
        'branch_id', 'user_id', 'shift_start', 'shift_end',
        'total_sales', 'cash_sales', 'card_sales', 'mobile_money_sales', 'other_sales',
        'total_transactions', 'declared_cash', 'expected_cash', 'variance',
        'notes', 'status', 'approved_by',
    ];

    protected $casts = [
        'shift_start'    => 'datetime',
        'shift_end'      => 'datetime',
        'total_sales'    => 'decimal:2',
        'cash_sales'     => 'decimal:2',
        'card_sales'     => 'decimal:2',
        'declared_cash'  => 'decimal:2',
        'expected_cash'  => 'decimal:2',
        'variance'       => 'decimal:2',
    ];

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function user(): BelongsTo   { return $this->belongsTo(User::class); }
    public function approvedBy(): BelongsTo { return $this->belongsTo(User::class, 'approved_by'); }
}
