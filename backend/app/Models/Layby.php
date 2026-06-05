<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class Layby extends Model {
    use HasFactory;
    protected $fillable = ['branch_id','customer_id','user_id','reference','total','deposit_paid','balance','status','due_date','notes','items'];
    protected $casts = ['items'=>'array','due_date'=>'date'];
    public function customer(){return $this->belongsTo(Customer::class);}
    public function user(){return $this->belongsTo(\App\Models\User::class);}
    public function branch(){return $this->belongsTo(Branch::class);}
    public function payments(){return $this->hasMany(LaybyPayment::class);}
}
