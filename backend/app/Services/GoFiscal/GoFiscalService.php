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
 *
 * Fiscal days run with the business day: Day End closes every device the
 * branch's tills use, and the first order after it opens them again. What's
 * known of each device's day is kept here (dayState), so an order or the
 * sync poll doesn't have to ask the engine.
 */
class GoFiscalService
{
    /** At checkout: the till gives up on the sale request after 15 s. */
    public const SALE_TIMEOUT = 8;
    /** The till waiting to print, and retries: under Nginx's 60 s. */
    public const FOLLOW_UP_TIMEOUT = 45;
    /** A fiscal day closed or opened ahead of a receipt — leaves it time to go after. */
    public const DAY_TIMEOUT = 20;

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

        $payload = $this->builder->forSale($sale, $this->taxes($deviceId, fetch: false));

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

        $deviceId = $this->deviceForRegister($refund->register_id) ?? $original->device_id;
        $payload = $original->status === 'submitted' ? $this->builder->forRefund($refund, $original, $this->taxes($deviceId, fetch: false)) : [];

        return DB::transaction(fn () => GoFiscalReceipt::firstOrCreate(['refund_id' => $refund->id], [
            'register_id' => $refund->register_id,
            'device_id' => $deviceId,
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

        // Rung up after Day End: it belongs to the next fiscal day, so the
        // one Day End ended is closed first. Not at checkout, which can't
        // wait that long — the till's follow-up does it.
        if ($this->closeOwedBefore($receipt)) {
            if ($timeout < self::FOLLOW_UP_TIMEOUT) {
                $receipt->update(['status' => 'pending', 'error_code' => 'fiscal_day_closing', 'last_error' => 'Waits until the last Day End\'s fiscal day is closed.']);
                return false;
            }
            $this->closeOwedDay($receipt->device_id, self::DAY_TIMEOUT);
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
                // The day isn't open, or ran out: start a new one and send
                // this receipt again. Not at checkout, which can't wait that
                // long — the till's follow-up does it.
                if (! $e->dayNotReady() || $timeout < self::FOLLOW_UP_TIMEOUT) {
                    throw $e;
                }
                $this->startNewDay($receipt->device_id, $e, self::DAY_TIMEOUT);
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
     * Then the fiscal day a Day End asked to close, if it isn't yet: after
     * the receipts rung up before it, so they're on that day.
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
        foreach ($byDevice->keys()->map(fn ($id) => (int) $id)->merge($this->branchDevices($branchId))->unique() as $deviceId) {
            $receipts = $byDevice->get($deviceId, collect());
            if ($receipts->isEmpty() && ! $this->dayState($deviceId)['close_owed']) {
                continue;
            }
            $lock = Cache::lock("gofiscal-sync-device-{$deviceId}", 300);
            if (! $lock->get()) {
                continue; // another till's sync is already on this device
            }
            try {
                $answering = true;
                foreach ($receipts as $receipt) {
                    if (! $force && ! $this->dueForRetry($receipt)) {
                        continue;
                    }
                    if ($this->submit($receipt)) {
                        $submitted++;
                    } elseif ($receipt->status === 'pending' && $receipt->error_code !== 'waiting_for_original') {
                        $answering = false;
                        break; // the engine isn't answering for this device — try again later
                    }
                }
                if ($answering) {
                    $this->closeOwedDay($deviceId);
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

    /**
     * What's known here of a device's fiscal day: open (true / false, or
     * null when nothing's known yet), close_owed (when the Day End that
     * asked for it to close was, until it has), and the last thing that
     * went wrong opening or closing it — tried again after retry_at.
     *
     * @return array{open: ?bool, close_owed: ?int, error: ?string, attempts: int, retry_at: ?int}
     */
    public function dayState(int $deviceId): array
    {
        return (array) Cache::get("gofiscal-day-{$deviceId}", []) + ['open' => null, 'close_owed' => null, 'error' => null, 'attempts' => 0, 'retry_at' => null];
    }

    /** Day End: the fiscal day on every device the branch's tills use is to close, from now. */
    public function dayEnded(int $branchId): void
    {
        foreach ($this->branchDevices($branchId) as $deviceId) {
            $this->rememberDay($deviceId, ['close_owed' => now()->timestamp, 'attempts' => 0, 'retry_at' => null]);
        }
    }

    /**
     * An order was punched: every device the branch's tills use gets its
     * fiscal day opened, if it isn't already — in practice, by the first
     * order after Day End. Never throws. A device known to be open costs
     * nothing; one the engine wouldn't open is tried by a later order.
     */
    public function openDaysForBranch(int $branchId): void
    {
        foreach ($this->branchDevices($branchId) as $deviceId) {
            $state = $this->dayState($deviceId);
            if (($state['open'] === true && ! $state['close_owed']) || $state['retry_at'] > now()->timestamp) {
                continue;
            }
            // The last Day End's day goes first; the next order opens the new
            // one. Each order spends one short call at most: on the desktop
            // server the till waits on this too.
            if ($state['close_owed']) {
                $this->closeOwedDay($deviceId, self::SALE_TIMEOUT);
                continue;
            }

            try {
                $this->openDay($deviceId, self::SALE_TIMEOUT);
            } catch (\Throwable $e) {
                if ($e instanceof GoFiscalException && $e->status === 409 && ! $e->dayNotReady()) {
                    $this->rememberDay($deviceId, ['open' => true]); // it already is
                    continue;
                }
                $this->dayFailed($deviceId, $e);
                Log::warning('GoFiscal fiscal day not opened', ['device_id' => $deviceId, 'error' => $e->getMessage()]);
            }
        }
    }

    /** Opens the device's fiscal day now. */
    public function openDay(int $deviceId, int $timeout = self::FOLLOW_UP_TIMEOUT): array
    {
        $body = app(GoFiscalClient::class)->openDay($deviceId, $timeout);
        $this->rememberDay($deviceId, ['open' => true, 'error' => null, 'attempts' => 0, 'retry_at' => null]);

        return $body;
    }

    /** Closes the device's fiscal day now — which settles any close a Day End asked for. */
    public function closeDay(int $deviceId, int $timeout = self::FOLLOW_UP_TIMEOUT): array
    {
        $body = app(GoFiscalClient::class)->closeDay($deviceId, $timeout);
        $this->rememberDay($deviceId, ['open' => false, 'close_owed' => null, 'error' => null, 'attempts' => 0, 'retry_at' => null]);

        return $body;
    }

    /**
     * Closes the day a Day End asked to, if it's still open. Never throws —
     * returns whether it's closed. One that won't is tried again by the
     * tills' sync poll, backing off from 30 s to 10 min.
     */
    public function closeOwedDay(int $deviceId, int $timeout = self::FOLLOW_UP_TIMEOUT): bool
    {
        $state = $this->dayState($deviceId);
        if (! $state['close_owed']) {
            return true;
        }
        if ($state['retry_at'] > now()->timestamp) {
            return false;
        }

        try {
            $this->closeDay($deviceId, $timeout);
            return true;
        } catch (\Throwable $e) {
            if ($e instanceof GoFiscalException && $e->errorCode === 'fiscal_day_not_open') {
                // Nothing open to close.
                $this->rememberDay($deviceId, ['open' => false, 'close_owed' => null, 'error' => null, 'attempts' => 0, 'retry_at' => null]);
                return true;
            }
            $this->dayFailed($deviceId, $e);
            Log::warning('GoFiscal fiscal day not closed', ['device_id' => $deviceId, 'error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * A receipt the engine refused for its fiscal day: one that ran out is
     * closed and a new one opened. A day that won't open may have an old one
     * still in the way — that's closed, and the new one opened after it.
     */
    private function startNewDay(int $deviceId, GoFiscalException $refused, int $timeout): void
    {
        $expired = $refused->errorCode === 'fiscal_day_expired';
        if ($expired) {
            $this->closeDay($deviceId, $timeout);
        }

        try {
            $this->openDay($deviceId, $timeout);
        } catch (GoFiscalException $e) {
            if ($expired) {
                return; // closed — the receipt opens the next day by itself
            }
            if ($e->status === 0) {
                throw $e;
            }
            $this->closeDay($deviceId, $timeout);
            $this->openDay($deviceId, $timeout);
        }
    }

    /** Whether the receipt was rung up after a Day End whose fiscal day hasn't closed yet. */
    private function closeOwedBefore(GoFiscalReceipt $receipt): bool
    {
        $owed = $this->dayState($receipt->device_id)['close_owed'];

        return $owed && $receipt->created_at && $receipt->created_at->timestamp >= $owed;
    }

    private function rememberDay(int $deviceId, array $changes): void
    {
        Cache::forever("gofiscal-day-{$deviceId}", array_merge($this->dayState($deviceId), $changes));
    }

    private function dayFailed(int $deviceId, \Throwable $e): void
    {
        $attempts = $this->dayState($deviceId)['attempts'] + 1;
        $this->rememberDay($deviceId, [
            'error' => $e->getMessage(),
            'attempts' => $attempts,
            'retry_at' => now()->addSeconds(min(600, 30 * 2 ** min($attempts - 1, 5)))->timestamp,
        ]);
    }

    /** @return \Illuminate\Support\Collection<int, int> The GoFiscal devices a branch's tills use. */
    private function branchDevices(int $branchId): \Illuminate\Support\Collection
    {
        return Register::where('branch_id', $branchId)->whereNotNull('gofiscal_device_id')
            ->pluck('gofiscal_device_id')->map(fn ($id) => (int) $id)->unique()->values();
    }

    /**
     * The device's taxes as the engine holds them (its copy of the ZIMRA
     * config), kept for a few hours: a line needs its tax's taxID when the
     * device has more than one tax on that line's code. Empty when they
     * can't be had — the lines then go by code alone, as before. With $fetch
     * false only what's kept is read: checkout doesn't wait on the engine
     * inside the sale's transaction (the receipt is rebuilt when it's sent).
     */
    public function taxes(int $deviceId, bool $fetch = true): array
    {
        $key = "gofiscal-taxes-{$deviceId}";
        $taxes = Cache::get($key);
        if (is_array($taxes) || ! $fetch) {
            return $taxes ?? [];
        }

        try {
            $taxes = array_values(array_filter((array) (app(GoFiscalClient::class)->config($deviceId, 5)['taxes'] ?? []), 'is_array'));
            Cache::put($key, $taxes, now()->addHours(6));
        } catch (\Throwable $e) {
            $taxes = [];
            Cache::put($key, $taxes, now()->addMinutes(5)); // not asked again on every receipt meanwhile
            Log::warning('GoFiscal device config not available', ['device_id' => $deviceId, 'error' => $e->getMessage()]);
        }

        return $taxes;
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
            return $this->builder->forSale($receipt->sale, $this->taxes($receipt->device_id));
        }
        if ($receipt->refund_id && $receipt->refund) {
            $original = $receipt->refund->sale?->goFiscalReceipt;
            return $original?->status === 'submitted' ? $this->builder->forRefund($receipt->refund, $original, $this->taxes($receipt->device_id)) : [];
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

        if ($this->dayState($receipt->device_id)['open'] !== true) {
            $this->rememberDay($receipt->device_id, ['open' => true]);
        }
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
        if ($e->errorCode === 'fiscal_day_not_open') {
            $this->rememberDay($receipt->device_id, ['open' => false]); // the next order opens it
        }

        Log::warning('GoFiscal receipt not through', ['gofiscal_receipt_id' => $receipt->id, 'error' => $e->errorCode, 'detail' => $e->getMessage()]);
    }
}
