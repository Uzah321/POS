<?php

namespace App\Services\GoFiscal;

use App\Models\GoFiscalReceipt;
use App\Models\Refund;
use App\Models\Register;
use App\Models\Sale;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Fiscalises sales and refunds through GoFiscal, for tills linked to one of
 * the engine's devices (registers.gofiscal_device_id). A receipt is recorded
 * as pending in the sale's own transaction, then sent once it has committed;
 * whatever doesn't go through is retried by the tills' sync poll.
 *
 * The invoiceNo (the sale / refund reference) is the engine's idempotency
 * key, so sending a receipt again is always safe: one it already has comes
 * back as it is, and no second sale is created.
 */
class GoFiscalService
{
    /** At checkout: the till gives up on the sale request after 15 s. */
    public const SALE_TIMEOUT = 8;
    /** The till waiting to print, and retries: under Nginx's 60 s. */
    public const FOLLOW_UP_TIMEOUT = 45;

    public function __construct(private readonly GoFiscalReceiptBuilder $builder)
    {
    }

    /** The GoFiscal device a till fiscalises through, or null. */
    public function deviceForRegister(?int $registerId): ?int
    {
        return $registerId ? Register::whereKey($registerId)->value('gofiscal_device_id') : null;
    }

    public function prepareForSale(Sale $sale): ?GoFiscalReceipt
    {
        $deviceId = $this->deviceForRegister($sale->register_id);
        if (! $deviceId) {
            return null;
        }

        $payload = $this->builder->forSale($sale);

        // A savepoint: if this fails, the sale's own transaction carries on.
        return DB::transaction(fn () => GoFiscalReceipt::firstOrCreate(['sale_id' => $sale->id], [
            'register_id' => $sale->register_id,
            'device_id' => $deviceId,
            'receipt_type' => 'FiscalInvoice',
            'invoice_no' => $sale->reference,
            'receipt_currency' => $payload['receiptCurrency'],
            'receipt_total' => $this->builder->total($payload['receiptLines']),
            'payload' => $payload,
        ]));
    }

    /** A credit note, when the refunded sale went through GoFiscal. It waits as pending until that sale's receipt is numbered. */
    public function prepareForRefund(Refund $refund): ?GoFiscalReceipt
    {
        $original = $refund->sale?->goFiscalReceipt;
        if (! $original) {
            return null;
        }

        $payload = $original->status === 'submitted' ? $this->builder->forRefund($refund, $original) : [];

        return DB::transaction(fn () => GoFiscalReceipt::firstOrCreate(['refund_id' => $refund->id], [
            'register_id' => $refund->register_id,
            'device_id' => $this->deviceForRegister($refund->register_id) ?? $original->device_id,
            'receipt_type' => 'CreditNote',
            'invoice_no' => $refund->reference,
            'receipt_currency' => $original->receipt_currency,
            'receipt_total' => -abs((float) $refund->amount),
            'payload' => $payload,
        ]));
    }

    /**
     * Sends a receipt to the engine and records its answer. Never throws —
     * returns whether the engine numbered it (accepted, or queued for ZIMRA).
     * The payload is rebuilt from the sale / refund each time, so a fix (an
     * HS code added, say) goes out with the next try.
     */
    public function submit(GoFiscalReceipt $receipt, int $timeout = self::FOLLOW_UP_TIMEOUT): bool
    {
        if ($receipt->status === 'submitted') {
            return true;
        }

        try {
            $payload = $this->freshPayload($receipt);
            if (! $payload) {
                $receipt->update(['status' => 'pending', 'error_code' => 'waiting_for_original', 'last_error' => 'Waits until the refunded sale\'s receipt is through.']);
                return false;
            }
            $receipt->payload = $payload;

            $client = app(GoFiscalClient::class);
            try {
                $result = $client->submitReceipt($receipt->device_id, $payload, $timeout);
            } catch (GoFiscalException $e) {
                // The day ran out (or was never opened): close it, and this
                // receipt opens the next. Not at checkout, which can't wait
                // that long — the till's follow-up does it.
                if (! $e->dayNeedsClosing() || $timeout < self::FOLLOW_UP_TIMEOUT) {
                    throw $e;
                }
                $client->closeDay($receipt->device_id, $timeout);
                $result = $client->submitReceipt($receipt->device_id, $payload, $timeout);
            }
        } catch (GoFiscalException $e) {
            $this->recordFailure($receipt, $e);
            return false;
        } catch (\Throwable $e) {
            $this->recordFailure($receipt, new GoFiscalException(0, 'internal', $e->getMessage()));
            return false;
        }

        $this->recordAnswer($receipt, $result['http'], $result['body']);

        return true;
    }

    /**
     * Retries a branch's receipts that haven't gone through, oldest first,
     * one device at a time (the engine numbers strictly in order, so
     * parallel calls to a device gain nothing). Pending ones back off after
     * each failed try; a refused one goes again only once something in it
     * has changed — or on $force (Sync Now), regardless.
     *
     * @return array{submitted: int, still_pending: int}
     */
    public function retryPendingForBranch(int $branchId, bool $force = false): array
    {
        $registerIds = Register::where('branch_id', $branchId)->pluck('id');
        $byDevice = GoFiscalReceipt::whereIn('register_id', $registerIds)
            ->whereIn('status', ['pending', 'failed'])
            ->orderBy('id')->limit(100)->get()
            ->groupBy('device_id');

        $submitted = 0;
        foreach ($byDevice as $deviceId => $receipts) {
            $lock = Cache::lock("gofiscal-sync-device-{$deviceId}", 300);
            if (! $lock->get()) {
                continue; // another till's sync is already on this device
            }
            try {
                foreach ($receipts as $receipt) {
                    if (! $force && ! $this->dueForRetry($receipt)) {
                        continue;
                    }
                    if ($this->submit($receipt)) {
                        $submitted++;
                    } elseif ($receipt->status === 'pending' && $receipt->error_code !== 'waiting_for_original') {
                        break; // the engine isn't answering for this device — try again later
                    }
                }
            } finally {
                $lock->release();
            }
        }

        return [
            'submitted' => $submitted,
            'still_pending' => GoFiscalReceipt::whereIn('register_id', $registerIds)->whereIn('status', ['pending', 'failed'])->count(),
        ];
    }

    /** Closes the fiscal day on every GoFiscal device a branch's tills use (Day End). Never throws. */
    public function closeDaysForBranch(int $branchId): void
    {
        $devices = Register::where('branch_id', $branchId)->whereNotNull('gofiscal_device_id')->pluck('gofiscal_device_id')->unique();
        foreach ($devices as $deviceId) {
            try {
                app(GoFiscalClient::class)->closeDay((int) $deviceId);
            } catch (\Throwable $e) {
                Log::warning('GoFiscal closeDay at Day End failed', ['device_id' => $deviceId, 'error' => $e->getMessage()]);
            }
        }
    }

    /** What a till needs to print a receipt's fiscal block. */
    public function summary(GoFiscalReceipt $receipt): array
    {
        return ['provider' => 'gofiscal'] + $receipt->only([
            'id', 'status', 'engine_status', 'device_id', 'receipt_global_no', 'receipt_counter',
            'fiscal_day_no', 'qr_data', 'qr_code_url', 'error_code', 'last_error',
        ]);
    }

    private function freshPayload(GoFiscalReceipt $receipt): array
    {
        if ($receipt->sale_id && $receipt->sale) {
            return $this->builder->forSale($receipt->sale);
        }
        if ($receipt->refund_id && $receipt->refund) {
            $original = $receipt->refund->sale?->goFiscalReceipt;
            return $original?->status === 'submitted' ? $this->builder->forRefund($receipt->refund, $original) : [];
        }

        return $receipt->payload ?? [];
    }

    private function dueForRetry(GoFiscalReceipt $receipt): bool
    {
        if ($receipt->status === 'failed') {
            // Refused as it stands — only worth sending once it has changed.
            try {
                return $this->freshPayload($receipt) != $receipt->payload;
            } catch (\Throwable) {
                return false;
            }
        }
        if ($receipt->attempts === 0) {
            return true;
        }

        // 15 s, 30 s, 1 min ... up to 10 min between tries
        $wait = min(600, 15 * 2 ** min($receipt->attempts - 1, 6));

        return $receipt->updated_at === null || $receipt->updated_at->lte(now()->subSeconds($wait));
    }

    private function recordAnswer(GoFiscalReceipt $receipt, int $http, array $body): void
    {
        $find = function (array $keys) use ($body) {
            foreach ([$body, $body['receipt'] ?? null, $body['data'] ?? null, $body['data']['receipt'] ?? null] as $where) {
                foreach (is_array($where) ? $keys : [] as $key) {
                    if (isset($where[$key]) && $where[$key] !== '') {
                        return $where[$key];
                    }
                }
            }
            return null;
        };

        $code = $find(['verificationCode', 'receiptVerificationCode']);
        $status = $find(['status']);

        $receipt->update([
            'status' => 'submitted',
            'engine_status' => is_string($status) ? $status : ($http === 202 ? 'queued' : 'accepted'),
            'receipt_global_no' => $find(['receiptGlobalNo']),
            'receipt_counter' => $find(['receiptCounter']),
            'fiscal_day_no' => $find(['fiscalDayNo']),
            'qr_data' => is_string($code) ? substr(strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code)), 0, 64) : null,
            'qr_code_url' => $find(['qrUrl', 'qrURL', 'qrCodeUrl']),
            'response' => $body,
            'payload' => $receipt->payload,
            'receipt_total' => $this->builder->total($receipt->payload['receiptLines'] ?? []),
            'error_code' => null,
            'last_error' => null,
            'attempts' => $receipt->attempts + 1,
            'submitted_at' => now(),
        ]);
    }

    private function recordFailure(GoFiscalReceipt $receipt, GoFiscalException $e): void
    {
        // Refused outright (422): nothing was numbered, and the same receipt
        // would be refused again — it needs fixing. Anything else is retried.
        $receipt->update([
            'status' => $e->status === 422 ? 'failed' : 'pending',
            'payload' => $receipt->payload,
            'error_code' => $e->errorCode,
            'last_error' => $e->getMessage(),
            'attempts' => $receipt->attempts + 1,
        ]);

        Log::warning('GoFiscal receipt not through', ['gofiscal_receipt_id' => $receipt->id, 'error' => $e->errorCode, 'detail' => $e->getMessage()]);
    }
}
