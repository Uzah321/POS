<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class StocktakeItem extends Model {
    use HasFactory;
    protected $fillable = ['stocktake_id','product_id','product_variant_id','ingredient_id','stock_id','ingredient_stock_id','expected_qty','counted_qty','variance'];
    public function product(){return $this->belongsTo(Product::class);}
    public function ingredient(){return $this->belongsTo(Ingredient::class);}
}
