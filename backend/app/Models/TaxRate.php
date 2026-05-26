<?php namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TaxRate extends Model
{
    protected $fillable = ['name', 'rate', 'is_default', 'is_active'];
    protected $casts = ['rate' => 'decimal:2', 'is_default' => 'boolean', 'is_active' => 'boolean'];
    public function products(): HasMany { return $this->hasMany(Product::class); }
}
