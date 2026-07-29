<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Register extends Model
{
    protected $fillable = ['branch_id', 'name', 'code', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function fiscalDevice(): HasOne { return $this->hasOne(FiscalDevice::class); }
    public function sales(): HasMany { return $this->hasMany(Sale::class); }
    public function refunds(): HasMany { return $this->hasMany(Refund::class); }
}
