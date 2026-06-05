<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class Commission extends Model {
    use HasFactory;
    protected $fillable = ['user_id','sale_id','amount','rate','status','paid_at'];
    protected $casts = ['paid_at'=>'datetime'];
    public function user(){return $this->belongsTo(\App\Models\User::class);}
    public function sale(){return $this->belongsTo(Sale::class);}
}
