<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Expense extends Model
{
    protected $fillable = [
        'reference', 'branch_id', 'expense_category_id', 'user_id', 'approved_by',
        'description', 'amount', 'expense_date', 'receipt_image', 'status',
    ];

    protected $casts = ['expense_date' => 'date', 'amount' => 'decimal:2'];

    protected static function booted(): void
    {
        static::creating(function (Expense $e) {
            if (! $e->reference) {
                $e->reference = 'EXP-' . strtoupper(uniqid());
            }
        });
    }

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function category(): BelongsTo { return $this->belongsTo(ExpenseCategory::class, 'expense_category_id'); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function approver(): BelongsTo { return $this->belongsTo(User::class, 'approved_by'); }
}
