<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class StockTransferItem extends Model {
    use HasFactory;
    protected $fillable = ['stock_transfer_id','product_id','product_variant_id','quantity'];
    public function product(){return $this->belongsTo(Product::class);}
}
