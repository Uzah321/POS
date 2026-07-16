<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class StocktakeItem extends Model {
    use HasFactory;
    protected $fillable = ['stocktake_id','product_id','product_variant_id','stock_id','expected_qty','counted_qty','variance'];
    public function product(){return $this->belongsTo(Product::class);}
}
