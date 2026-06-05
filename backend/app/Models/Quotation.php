<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class Quotation extends Model {
    use HasFactory;
    protected $fillable = ['branch_id','customer_id','user_id','reference','status','subtotal','tax','discount','total','valid_until','notes'];
    protected $casts = ['valid_until'=>'date'];
    public function customer(){return $this->belongsTo(Customer::class);}
    public function user(){return $this->belongsTo(\App\Models\User::class);}
    public function branch(){return $this->belongsTo(Branch::class);}
    public function items(){return $this->hasMany(QuotationItem::class);}
}
