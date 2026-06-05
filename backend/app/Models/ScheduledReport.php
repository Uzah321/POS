<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class ScheduledReport extends Model {
    use HasFactory;
    protected $fillable = ['type','frequency','email','active','last_sent_at'];
    protected $casts = ['active'=>'boolean','last_sent_at'=>'datetime'];
}
