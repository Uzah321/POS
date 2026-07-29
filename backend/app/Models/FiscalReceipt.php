<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FiscalReceipt extends Model
{
    protected $fillable = [
        'fiscal_device_id', 'fiscal_day_id', 'sale_id', 'refund_id',
        'receipt_type', 'receipt_counter', 'receipt_global_no', 'invoice_no',
        'receipt_currency', 'receipt_total', 'payload', 'previous_receipt_hash',
        'device_hash', 'device_signature', 'status', 'zimra_receipt_id',
        'server_signature', 'qr_data', 'qr_code_url', 'validation_note',
        'attempts', 'last_error', 'submitted_at',
    ];

    protected $casts = [
        'receipt_total'    => 'decimal:2',
        'payload'          => 'array',
        'server_signature' => 'array',
        'submitted_at'     => 'datetime',
    ];

    public function fiscalDevice(): BelongsTo { return $this->belongsTo(FiscalDevice::class); }
    public function fiscalDay(): BelongsTo { return $this->belongsTo(FiscalDay::class); }
    public function sale(): BelongsTo { return $this->belongsTo(Sale::class); }
    public function refund(): BelongsTo { return $this->belongsTo(Refund::class); }
}
