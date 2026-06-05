<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class ProductBatch extends Model {
    use HasFactory;
    protected $fillable = ['product_id','product_variant_id','batch_number','expiry_date','quantity','cost_price'];
    protected $casts = ['expiry_date'=>'date'];
    public function product(){return $this->belongsTo(Product::class);}
}
