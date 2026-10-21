<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A sale or refund sent to GoFiscal, and what the engine answered — see App\Services\GoFiscal\GoFiscalService. */
class GoFiscalReceipt extends Model
{
    protected $table = 'gofiscal_receipts';

    protected $fillable = [
        'sale_id', 'refund_id', 'register_id', 'device_id',
        'receipt_type', 'invoice_no', 'receipt_currency', 'receipt_total', 'payload',
        'status', 'engine_status', 'receipt_global_no', 'receipt_counter', 'fiscal_day_no',
        'qr_data', 'qr_code_url', 'response',
        'error_code', 'last_error', 'attempts', 'submitted_at',
    ];

    protected $casts = [
        'device_id'         => 'integer',
        'receipt_total'     => 'decimal:2',
        'payload'           => 'array',
        'response'          => 'array',
        'receipt_global_no' => 'integer',
        'receipt_counter'   => 'integer',
        'fiscal_day_no'     => 'integer',
        'submitted_at'      => 'datetime',
    ];

    public function sale(): BelongsTo { return $this->belongsTo(Sale::class); }
    public function refund(): BelongsTo { return $this->belongsTo(Refund::class); }
    public function register(): BelongsTo { return $this->belongsTo(Register::class); }
}
