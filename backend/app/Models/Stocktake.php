<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class Stocktake extends Model {
    use HasFactory;
    protected $fillable = ['branch_id','user_id','reference','status','notes'];
    public function user(){return $this->belongsTo(\App\Models\User::class);}
    public function branch(){return $this->belongsTo(Branch::class);}
    public function items(){return $this->hasMany(StocktakeItem::class)->orderBy('id');}
}
