<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FiscalDevice extends Model
{
    protected $fillable = [
        'register_id', 'device_id', 'activation_key', 'device_serial_no',
        'key_algorithm', 'private_key', 'certificate', 'certificate_valid_till',
        'environment', 'operating_mode',
        'taxpayer_name', 'taxpayer_tin', 'vat_number', 'branch_name', 'branch_address',
        'tax_payer_day_max_hrs', 'tax_payer_day_end_notification_hrs', 'qr_url',
        'next_receipt_global_no', 'status', 'last_error',
    ];

    protected $casts = [
        'certificate_valid_till' => 'date',
        'branch_address'         => 'array',
        'next_receipt_global_no' => 'integer',
        // Never persisted to disk decrypted — see ZimraApiClient, which writes
        // these out to a temp file only for the lifetime of a single mTLS request.
        'activation_key'         => 'encrypted',
        'private_key'            => 'encrypted',
    ];

    public function register(): BelongsTo { return $this->belongsTo(Register::class); }
    public function taxMappings(): HasMany { return $this->hasMany(FiscalTaxMapping::class); }
    public function fiscalDays(): HasMany { return $this->hasMany(FiscalDay::class); }
    public function fiscalReceipts(): HasMany { return $this->hasMany(FiscalReceipt::class); }

    public function isRegistered(): bool
    {
        return $this->status === 'registered' && ! empty($this->certificate) && ! empty($this->private_key);
    }

    public function currentFiscalDay(): ?FiscalDay
    {
        return $this->fiscalDays()->whereIn('status', ['opened', 'close_failed'])->latest('fiscal_day_no')->first();
    }
}
