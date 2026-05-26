<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EndOfDay extends Model
{
    protected $table = 'end_of_day';

    protected $fillable = [
        'branch_id', 'user_id', 'report_date', 'opening_cash', 'cash_sales', 'card_sales',
        'mobile_money_sales', 'other_sales', 'total_sales', 'total_refunds', 'total_expenses',
        'expected_cash', 'actual_cash', 'difference', 'notes', 'status',
    ];

    protected $casts = [
        'report_date' => 'date',
        'opening_cash' => 'decimal:2',
        'cash_sales' => 'decimal:2',
        'expected_cash' => 'decimal:2',
        'actual_cash' => 'decimal:2',
        'difference' => 'decimal:2',
    ];

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
