<?php

namespace App\Models;

use App\Models\Concerns\ServesImageByUrl;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Category extends Model
{
    use ServesImageByUrl;

    protected function imageRouteSegment(): string { return 'categories'; }

    protected $fillable = ['name', 'slug', 'branch_id', 'parent_id', 'image', 'color', 'description', 'is_active', 'sort_order', 'business_type'];
    protected $casts = ['is_active' => 'boolean'];

    public function parent(): BelongsTo { return $this->belongsTo(Category::class, 'parent_id'); }
    public function children(): HasMany { return $this->hasMany(Category::class, 'parent_id'); }
    public function products(): HasMany { return $this->hasMany(Product::class); }
}
