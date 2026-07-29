<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FiscalTaxMapping extends Model
{
    protected $fillable = [
        'fiscal_device_id', 'zimra_tax_id', 'tax_percent', 'tax_name',
        'valid_from', 'valid_till', 'local_tax_rate_id',
    ];

    protected $casts = [
        'tax_percent' => 'decimal:2',
        'valid_from'  => 'date',
        'valid_till'  => 'date',
    ];

    public function fiscalDevice(): BelongsTo { return $this->belongsTo(FiscalDevice::class); }
    public function taxRate(): BelongsTo { return $this->belongsTo(TaxRate::class, 'local_tax_rate_id'); }
}
