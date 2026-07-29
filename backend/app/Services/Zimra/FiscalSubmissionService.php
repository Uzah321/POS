<?php

namespace App\Services\Zimra;

use App\Models\FiscalDay;
use App\Models\FiscalDevice;
use App\Models\FiscalReceipt;
use App\Models\Refund;
use App\Models\Sale;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

/**
 * Allocates receipt numbering and drives submission to ZIMRA. Numbering is
 * allocated once — inside the same DB transaction as the sale/refund — and
 * never changes on retry; only ZIMRA's own acceptance moves a receipt out of
 * "pending" (see §9 rule 13). attemptSubmit() never throws, so it's safe to
 * call from a controller after its own transaction has already committed.
 */
class FiscalSubmissionService
{
    public function __construct(
        private readonly FiscalDeviceService $deviceService,
        private readonly FiscalReceiptBuilder $builder,
        private readonly ZimraCryptoService $crypto,
    ) {
    }

    /** Resolves the registered, ready-to-submit fiscal device for a register, or null if fiscalisation isn't set up for it. */
    public function deviceForRegister(?int $registerId): ?FiscalDevice
    {
        if (! $registerId) {
            return null;
        }

        $device = FiscalDevice::whereHas('register', fn ($q) => $q->whereKey($registerId))->first();

        return $device?->isRegistered() ? $device : null;
    }

    /** Allocates numbering + builds/signs the FiscalInvoice payload for $sale. Returns null if fiscalisation isn't configured for its register. */
    public function prepareForSale(Sale $sale): ?FiscalReceipt
    {
        $device = $this->deviceForRegister($sale->register_id);
        if (! $device) {
            return null;
        }

        [$device, $fiscalDay, $receiptCounter, $receiptGlobalNo, $previousHash] = $this->allocateNumbering($device);

        $payload = $this->builder->buildForSale($sale, $device, $receiptCounter, $receiptGlobalNo, $previousHash);

        return $this->persistReceipt($device, $fiscalDay, $payload, [
            'sale_id' => $sale->id,
            'receipt_type' => 'FiscalInvoice',
            'receipt_counter' => $receiptCounter,
            'receipt_global_no' => $receiptGlobalNo,
            'invoice_no' => $sale->reference,
            'previous_receipt_hash' => $previousHash,
        ]);
    }

    /** Allocates numbering + builds/signs a CreditNote payload for $refund. Returns null if fiscalisation isn't set up, or the original sale's receipt isn't accepted by ZIMRA yet (RCPT032 requires it to exist first). */
    public function prepareForRefund(Refund $refund): ?FiscalReceipt
    {
        $device = $this->deviceForRegister($refund->register_id);
        if (! $device) {
            return null;
        }

        $originalReceipt = $refund->sale?->fiscalReceipt;
        if (! $originalReceipt || $originalReceipt->status !== 'submitted') {
            return null;
        }

        [$device, $fiscalDay, $receiptCounter, $receiptGlobalNo, $previousHash] = $this->allocateNumbering($device);

        $payload = $this->builder->buildForRefund($refund, $device, $receiptCounter, $receiptGlobalNo, $previousHash, $originalReceipt);

        return $this->persistReceipt($device, $fiscalDay, $payload, [
            'refund_id' => $refund->id,
            'receipt_type' => 'CreditNote',
            'receipt_counter' => $receiptCounter,
            'receipt_global_no' => $receiptGlobalNo,
            'invoice_no' => $refund->reference,
            'previous_receipt_hash' => $previousHash,
        ]);
    }

    /** @return array{0: FiscalDevice, 1: FiscalDay, 2: int, 3: int, 4: ?string} */
    private function allocateNumbering(FiscalDevice $device): array
    {
        $device = FiscalDevice::whereKey($device->id)->lockForUpdate()->firstOrFail();
        $fiscalDay = $this->deviceService->ensureDayOpenLocally($device);

        $lastReceipt = FiscalReceipt::where('fiscal_device_id', $device->id)->orderByDesc('receipt_global_no')->first();
        $receiptGlobalNo = $device->next_receipt_global_no;
        $receiptCounter = $fiscalDay->last_receipt_counter + 1;

        $device->increment('next_receipt_global_no');
        $fiscalDay->increment('last_receipt_counter');

        return [$device, $fiscalDay, $receiptCounter, $receiptGlobalNo, $lastReceipt?->device_hash];
    }

    private function persistReceipt(FiscalDevice $device, FiscalDay $fiscalDay, array $payload, array $extra): FiscalReceipt
    {
        return FiscalReceipt::create(array_merge([
            'fiscal_device_id' => $device->id,
            'fiscal_day_id' => $fiscalDay->id,
            'receipt_currency' => $payload['receiptCurrency'],
            'receipt_total' => $payload['receiptTotal'],
            'payload' => $payload,
            'device_hash' => $payload['receiptDeviceSignature']['hash'],
            'device_signature' => $payload['receiptDeviceSignature']['signature'],
            'status' => 'pending',
        ], $extra));
    }

    /** Submits a pending/failed receipt to ZIMRA. Never throws — returns whether it succeeded. */
    public function attemptSubmit(FiscalReceipt $receipt): bool
    {
        if ($receipt->status === 'submitted') {
            return true;
        }

        $device = $receipt->fiscalDevice;
        $day = $receipt->fiscalDay;

        try {
            if (! $day->opened_remotely_at) {
                $this->deviceService->sendPendingDayOpen($device, $day);
            }

            $response = (new ZimraApiClient($device))->submitReceipt($receipt->payload);

            $qrData = $this->crypto->qrData($receipt->device_signature);
            $qrUrl = $device->qr_url
                ? $this->crypto->qrCodeUrl($device->qr_url, $device->device_id, Carbon::parse($receipt->payload['receiptDate']), $receipt->receipt_global_no, $qrData)
                : null;

            $receipt->update([
                'status' => 'submitted',
                'zimra_receipt_id' => $response['receiptID'] ?? null,
                'server_signature' => $response['receiptServerSignature'] ?? null,
                'qr_data' => $qrData,
                'qr_code_url' => $qrUrl,
                'submitted_at' => now(),
                'attempts' => $receipt->attempts + 1,
                'last_error' => null,
            ]);

            $this->applyDayCounters($day, $receipt);

            return true;
        } catch (\Throwable $e) {
            $receipt->update(['status' => 'failed', 'attempts' => $receipt->attempts + 1, 'last_error' => $e->getMessage()]);
            Log::warning('ZIMRA submitReceipt failed', ['fiscal_receipt_id' => $receipt->id, 'error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * Retries every pending/failed fiscal receipt for a branch's registers,
     * oldest receipt_global_no first per device. §9 rule 13 requires strict
     * ascending submission order, so a device stops at its first still-failing
     * receipt — submitting a later one out of order would only compound the gap.
     *
     * @return array{submitted: int, still_pending: int}
     */
    public function retryPendingForBranch(int $branchId): array
    {
        $results = ['submitted' => 0, 'still_pending' => 0];

        $devices = FiscalDevice::whereHas('register', fn ($q) => $q->where('branch_id', $branchId))
            ->where('status', 'registered')->get();

        foreach ($devices as $device) {
            $receipts = FiscalReceipt::where('fiscal_device_id', $device->id)
                ->whereIn('status', ['pending', 'failed'])
                ->orderBy('receipt_global_no')
                ->get();

            foreach ($receipts as $receipt) {
                if ($this->attemptSubmit($receipt)) {
                    $results['submitted']++;
                } else {
                    $results['still_pending']++;
                    break;
                }
            }

            $openDay = $device->currentFiscalDay();
            if ($openDay && $openDay->status === 'close_failed') {
                $this->deviceService->closeDay($device, $openDay);
            }
        }

        return $results;
    }

    /** Rolls a submitted receipt's amounts into its fiscal day's running counters (§6). */
    private function applyDayCounters(FiscalDay $day, FiscalReceipt $receipt): void
    {
        $payload = $receipt->payload;
        $currency = $payload['receiptCurrency'];
        $counters = collect($day->counters ?? []);

        $add = function (string $type, string $currency, ?int $taxId, null|int|float $taxPercent, ?string $moneyType, float $value) use (&$counters) {
            $index = $counters->search(fn ($c) => $c['type'] === $type
                && $c['currency'] === $currency
                && ($c['tax_id'] ?? null) === $taxId
                && ($c['money_type'] ?? null) === $moneyType);

            if ($index === false) {
                $counters->push([
                    'type' => $type, 'currency' => $currency, 'tax_id' => $taxId,
                    'tax_percent' => $taxPercent, 'money_type' => $moneyType, 'value' => round($value, 2),
                ]);
            } else {
                $row = $counters[$index];
                $row['value'] = round($row['value'] + $value, 2);
                $counters->put($index, $row);
            }
        };

        // Field values on the payload are already correctly signed per receipt
        // type (negative for CreditNote — see FiscalReceiptBuilder), so they're
        // added as-is; the *ByTax counters just accumulate them.
        $suffix = match ($receipt->receipt_type) {
            'CreditNote' => 'CreditNote',
            'DebitNote' => 'DebitNote',
            default => 'Sale',
        };

        foreach ($payload['receiptTaxes'] as $tax) {
            $taxId = $tax['taxID'] ?? 0;
            $add("{$suffix}ByTax", $currency, $taxId, $tax['taxPercent'] ?? null, null, (float) $tax['salesAmountWithTax']);
            $add("{$suffix}TaxByTax", $currency, $taxId, $tax['taxPercent'] ?? null, null, (float) $tax['taxAmount']);
        }

        foreach ($payload['receiptPayments'] as $payment) {
            $add('BalanceByMoneyType', $currency, null, null, $payment['moneyTypeCode'], (float) $payment['paymentAmount']);
        }

        $day->update(['counters' => $counters->values()->all()]);
    }
}
