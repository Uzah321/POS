<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class LaybyPayment extends Model {
    use HasFactory;
    protected $fillable = ['layby_id','user_id','amount','method','notes'];
    public function layby(){return $this->belongsTo(Layby::class);}
    public function user(){return $this->belongsTo(\App\Models\User::class);}
}
