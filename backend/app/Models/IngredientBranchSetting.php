<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IngredientBranchSetting extends Model
{
    protected $fillable = ['ingredient_id', 'branch_id', 'recommended_quantity', 'minimum_quantity'];

    public function ingredient(): BelongsTo { return $this->belongsTo(Ingredient::class); }
    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
}
