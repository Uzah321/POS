<?php

namespace App\Services\Zimra;

use App\Models\EndOfDay;
use App\Models\FiscalDay;
use App\Models\FiscalDevice;
use App\Models\FiscalReceipt;
use App\Models\GoFiscalReceipt;
use App\Models\Refund;
use App\Models\Register;
use App\Models\Sale;
use App\Services\GoFiscal\GoFiscalService;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Allocates receipt numbering and drives submission to ZIMRA. Numbering is
 * allocated once — inside the same DB transaction as the sale/refund — and
 * never changes on retry; only ZIMRA's own acceptance moves a receipt out of
 * "pending" (see §9 rule 13). attemptSubmit() never throws, so it's safe to
 * call from a controller after its own transaction has already committed.
 *
 * A till linked to a GoFiscal device fiscalises through the engine instead
 * (App\Services\GoFiscal\GoFiscalService) — the same calls, a GoFiscalReceipt.
 */
class FiscalSubmissionService
{
    public function __construct(
        private readonly FiscalDeviceService $deviceService,
        private readonly FiscalReceiptBuilder $builder,
        private readonly ZimraCryptoService $crypto,
        private readonly GoFiscalService $goFiscal,
    ) {
    }

    /** What the till needs to print a receipt's fiscal block, for either kind of receipt. */
    public function summary(FiscalReceipt|GoFiscalReceipt|null $receipt): ?array
    {
        if ($receipt instanceof GoFiscalReceipt) {
            return $this->goFiscal->summary($receipt);
        }

        return $receipt ? ['provider' => 'zimra'] + $receipt->only([
            'id', 'status', 'receipt_global_no', 'fiscal_day_id', 'qr_data', 'qr_code_url', 'last_error',
        ]) : null;
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
    public function prepareForSale(Sale $sale): FiscalReceipt|GoFiscalReceipt|null
    {
        if ($this->goFiscal->deviceForRegister($sale->register_id)) {
            return $this->goFiscal->prepareForSale($sale);
        }

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
    public function prepareForRefund(Refund $refund): FiscalReceipt|GoFiscalReceipt|null
    {
        if ($refund->sale?->goFiscalReceipt) {
            return $this->goFiscal->prepareForRefund($refund);
        }

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
    public function attemptSubmit(FiscalReceipt|GoFiscalReceipt $receipt): bool
    {
        if ($receipt instanceof GoFiscalReceipt) {
            // Short, so the sale's own response reaches the till in time — a
            // receipt still pending is fetched by the till before it prints.
            return $this->goFiscal->submit($receipt, GoFiscalService::SALE_TIMEOUT);
        }

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
     * Then the branch's GoFiscal receipts — $force (Sync Now) resends even
     * ones the engine refused that haven't changed since.
     *
     * @return array{submitted: int, still_pending: int}
     */
    public function retryPendingForBranch(int $branchId, bool $force = false): array
    {
        $results = $this->goFiscal->retryPendingForBranch($branchId, $force);

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

            // Then the day a Day End ended, if it isn't closed yet: a close
            // that failed goes again, one ZIMRA is still on is asked after,
            // and one that never went (Day End's own try didn't run) goes now.
            $day = $device->fiscalDays()->latest('fiscal_day_no')->first();
            if ($day?->status === 'close_initiated') {
                $this->deviceService->refreshCloseStatus($device, $day);
            } elseif ($day && ($day->status === 'close_failed' || ($day->status === 'opened' && $this->dayEndedSince($day)))) {
                $this->deviceService->closeDay($device, $day);
            }
        }

        return $results;
    }

    /** Day End: every fiscal till of the branch is to close its day — see closeDaysForBranch(). */
    public function dayEnded(int $branchId): void
    {
        $this->goFiscal->dayEnded($branchId);
    }

    /**
     * Day End's close, once the till has its answer: what's still pending
     * goes first, so it's on the day, then every fiscal till of the branch
     * closes its day. Never throws — whatever doesn't close is retried by
     * the tills' sync poll (retryPendingForBranch) until it does.
     */
    public function closeDaysForBranch(int $branchId): void
    {
        try {
            $this->retryPendingForBranch($branchId);
        } catch (\Throwable $e) {
            Log::warning('Closing fiscal days at Day End failed', ['branch_id' => $branchId, 'error' => $e->getMessage()]);
        }
    }

    /**
     * An order was punched: every fiscal till of the branch whose day isn't
     * open gets it opened — in practice, by the first order after Day End.
     * Never throws. A till whose day is open costs no call to ZIMRA; one
     * still owing Day End's close is left to the sync poll to close first.
     */
    public function openDaysForBranch(int $branchId): void
    {
        try {
            $this->goFiscal->openDaysForBranch($branchId);
        } catch (\Throwable $e) {
            Log::warning('Opening GoFiscal days failed', ['branch_id' => $branchId, 'error' => $e->getMessage()]);
        }

        // A till linked to GoFiscal fiscalises there, not through its own device.
        $devices = FiscalDevice::whereHas('register', fn ($q) => $q->where('branch_id', $branchId)->whereNull('gofiscal_device_id'))
            ->where('status', 'registered')->get()->filter->isRegistered();
        foreach ($devices as $device) {
            $day = $device->currentFiscalDay();
            if ($day && ($day->opened_remotely_at || $day->status !== 'opened' || $this->dayEndedSince($day))) {
                continue;
            }
            // One try at telling ZIMRA every 2 minutes, while it can't be reached.
            if (! Cache::add("zimra-day-open-{$device->id}", true, 120)) {
                continue;
            }
            try {
                $this->deviceService->sendPendingDayOpen($device, $day ?? $this->deviceService->ensureDayOpenLocally($device));
            } catch (\Throwable $e) {
                Log::warning('ZIMRA openDay on first order failed', ['fiscal_device_id' => $device->id, 'error' => $e->getMessage()]);
            }
        }
    }

    /**
     * Where each fiscal till of the branch stands with its fiscal day, for
     * the Day End page: open, closing (Day End asked; not through yet —
     * error says why) or closed.
     *
     * @return list<array{register: string, provider: string, status: string, error: ?string}>
     */
    public function dayStatusForBranch(int $branchId): array
    {
        $registers = Register::with('fiscalDevice')->where('branch_id', $branchId)->orderBy('name')->get();

        $rows = [];
        foreach ($registers as $register) {
            if ($register->gofiscal_device_id) {
                $state = $this->goFiscal->dayState((int) $register->gofiscal_device_id);
                $rows[] = [
                    'register' => $register->name,
                    'provider' => 'gofiscal',
                    'status' => $state['close_owed'] ? 'closing' : match ($state['open']) { true => 'open', false => 'closed', null => 'unknown' },
                    'error' => $state['error'],
                ];
            } elseif ($register->fiscalDevice?->isRegistered()) {
                $day = $register->fiscalDevice->fiscalDays()->latest('fiscal_day_no')->first();
                $rows[] = [
                    'register' => $register->name,
                    'provider' => 'zimra',
                    'status' => match ($day?->status) {
                        null, 'closed' => 'closed',
                        'opened' => $this->dayEndedSince($day) ? 'closing' : 'open',
                        default => 'closing',
                    },
                    'error' => $day?->status === 'close_failed' ? $day->closing_error_code : null,
                ];
            }
        }

        return $rows;
    }

    /** Whether the branch has closed its day since this fiscal day opened — so it's owed a close. */
    private function dayEndedSince(FiscalDay $day): bool
    {
        $branchId = $day->fiscalDevice?->register?->branch_id;

        return $branchId && EndOfDay::where('branch_id', $branchId)->where('created_at', '>', $day->opened_at)->exists();
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
