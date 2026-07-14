<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class StockTransferItem extends Model {
    use HasFactory;
    protected $fillable = ['stock_transfer_id','product_id','product_variant_id','quantity','received_quantity','received_product_id'];
    public function product(){return $this->belongsTo(Product::class);}
    public function receivedProduct(){return $this->belongsTo(Product::class, 'received_product_id');}
}
