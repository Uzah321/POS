<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Attendance extends Model
{
    protected $fillable = ['user_id', 'branch_id', 'date', 'clock_in', 'clock_out', 'hours_worked', 'status', 'notes'];
    protected $casts = ['date' => 'date', 'hours_worked' => 'decimal:2'];

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
}
