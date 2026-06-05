<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
class QuotationItem extends Model {
    use HasFactory;
    protected $fillable = ['quotation_id','product_id','product_variant_id','name','quantity','unit_price','discount','tax_amount','subtotal'];
    public function product(){return $this->belongsTo(Product::class);}
}
