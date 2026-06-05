<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Salary extends Model
{
    protected $fillable = [
        'reference', 'branch_id', 'created_by', 'employee_id', 'employee_name',
        'position', 'pay_month',
        'basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowances',
        'gross_salary', 'paye', 'nssa', 'other_deductions', 'total_deductions', 'net_salary',
        'status', 'payment_method', 'paid_at', 'notes',
    ];

    protected $casts = [
        'basic_salary'       => 'decimal:2',
        'housing_allowance'  => 'decimal:2',
        'transport_allowance'=> 'decimal:2',
        'other_allowances'   => 'decimal:2',
        'gross_salary'       => 'decimal:2',
        'paye'               => 'decimal:2',
        'nssa'               => 'decimal:2',
        'other_deductions'   => 'decimal:2',
        'total_deductions'   => 'decimal:2',
        'net_salary'         => 'decimal:2',
        'paid_at'            => 'date',
    ];

    public function branch()   { return $this->belongsTo(Branch::class); }
    public function creator()  { return $this->belongsTo(User::class, 'created_by'); }
    public function employee() { return $this->belongsTo(User::class, 'employee_id'); }
}
