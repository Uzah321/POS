<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FiscalDay extends Model
{
    protected $fillable = [
        'fiscal_device_id', 'fiscal_day_no', 'status', 'opened_at', 'opened_remotely_at', 'closed_at',
        'counters', 'last_receipt_counter', 'closing_error_code',
        'device_signature', 'server_signature',
    ];

    protected $casts = [
        'opened_at'          => 'datetime',
        'opened_remotely_at' => 'datetime',
        'closed_at'          => 'datetime',
        'counters'           => 'array',
        'server_signature'   => 'array',
    ];

    public function fiscalDevice(): BelongsTo { return $this->belongsTo(FiscalDevice::class); }
    public function fiscalReceipts(): HasMany { return $this->hasMany(FiscalReceipt::class); }
}
