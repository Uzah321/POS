<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class StockTransfer extends Model {
    use HasFactory;
    protected $fillable = ['from_branch_id','to_branch_id','user_id','reference','status','notes'];
    public function user(){return $this->belongsTo(\App\Models\User::class);}
    public function fromBranch(){return $this->belongsTo(Branch::class,'from_branch_id');}
    public function toBranch(){return $this->belongsTo(Branch::class,'to_branch_id');}
    public function items(){return $this->hasMany(StockTransferItem::class);}
}
