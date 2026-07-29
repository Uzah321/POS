<?php

namespace App\Services\Zimra;

use App\Models\FiscalDay;
use App\Models\FiscalDevice;
use App\Models\FiscalTaxMapping;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Orchestrates a fiscal device's lifecycle: registration, config refresh,
 * certificate renewal, and fiscal day open/close. Receipt submission itself
 * lives in FiscalSubmissionService — this class only manages the device and
 * its days.
 */
class FiscalDeviceService
{
    public function __construct(
        private readonly ZimraCryptoService $crypto,
    ) {
    }

    private function client(FiscalDevice $device): ZimraApiClient
    {
        return new ZimraApiClient($device);
    }

    /** Pure lookup — does not persist anything, just lets an admin double-check the deviceID/activationKey before registering. */
    public function verifyTaxpayer(FiscalDevice $device, int $deviceId, string $activationKey, string $deviceSerialNo): array
    {
        return $this->client($device)->verifyTaxpayerInformation($deviceId, $activationKey, $deviceSerialNo);
    }

    /** Generates a fresh keypair+CSR, registers the device with ZIMRA, stores the issued certificate, then pulls config. */
    public function register(FiscalDevice $device, int $deviceId, string $activationKey, string $deviceSerialNo, string $keyAlgorithm = 'ecc'): FiscalDevice
    {
        $keyPair = $this->crypto->generateKeyPair($keyAlgorithm);
        $csr = $this->crypto->buildCsr($deviceSerialNo, $deviceId, $keyPair['private_key']);

        // Persist enough to make the registerDevice call (it's a public endpoint,
        // no cert needed yet), then store what ZIMRA returns.
        $device->fill([
            'device_id' => $deviceId,
            'activation_key' => $activationKey,
            'device_serial_no' => $deviceSerialNo,
            'key_algorithm' => $keyAlgorithm,
            'private_key' => $keyPair['private_key'],
            'environment' => $device->environment ?: 'test',
        ])->save();

        try {
            $response = $this->client($device)->registerDevice($deviceId, $activationKey, $csr);
        } catch (\Throwable $e) {
            $device->update(['status' => 'error', 'last_error' => $e->getMessage()]);
            throw $e;
        }

        $device->update([
            'certificate' => $response['certificate'],
            'status' => 'registered',
            'last_error' => null,
        ]);

        $this->refreshConfig($device);

        return $device->fresh();
    }

    /** Renews the device's certificate — generates a new keypair, per ZIMRA's own recommended practice for reissuance. */
    public function renewCertificate(FiscalDevice $device, string $keyAlgorithm = 'ecc'): FiscalDevice
    {
        $keyPair = $this->crypto->generateKeyPair($keyAlgorithm);
        $csr = $this->crypto->buildCsr($device->device_serial_no, $device->device_id, $keyPair['private_key']);

        $response = $this->client($device)->issueCertificate($csr);

        $device->update([
            'key_algorithm' => $keyAlgorithm,
            'private_key' => $keyPair['private_key'],
            'certificate' => $response['certificate'],
            'status' => 'registered',
            'last_error' => null,
        ]);

        return $device->fresh();
    }

    /** Pulls taxpayer/branch/config info + applicable taxes, caching them locally. */
    public function refreshConfig(FiscalDevice $device): FiscalDevice
    {
        $config = $this->client($device)->getConfig();

        $device->update([
            'taxpayer_name' => $config['taxPayerName'] ?? null,
            'taxpayer_tin' => $config['taxPayerTIN'] ?? null,
            'vat_number' => $config['vatNumber'] ?? null,
            'branch_name' => $config['deviceBranchName'] ?? null,
            'branch_address' => $config['deviceBranchAddress'] ?? null,
            'operating_mode' => strtolower($config['deviceOperatingMode'] ?? 'online'),
            'tax_payer_day_max_hrs' => $config['taxPayerDayMaxHrs'] ?? null,
            'tax_payer_day_end_notification_hrs' => $config['taxpayerDayEndNotificationHrs'] ?? null,
            'qr_url' => $config['qrUrl'] ?? null,
            'certificate_valid_till' => $config['certificateValidTill'] ?? null,
        ]);

        $this->syncTaxMappings($device, $config['applicableTaxes'] ?? []);

        return $device->fresh();
    }

    /** Upserts ZIMRA's applicable taxes list — never touches an existing row's local_tax_rate_id mapping choice. */
    private function syncTaxMappings(FiscalDevice $device, array $applicableTaxes): void
    {
        foreach ($applicableTaxes as $tax) {
            FiscalTaxMapping::updateOrCreate(
                ['fiscal_device_id' => $device->id, 'zimra_tax_id' => $tax['taxID']],
                [
                    'tax_percent' => $tax['taxPercent'] ?? null,
                    'tax_name' => $tax['taxName'],
                    'valid_from' => $tax['taxValidFrom'],
                    'valid_till' => $tax['taxValidTill'] ?? null,
                ],
            );
        }
    }

    /**
     * Ensures a fiscal day exists locally for today's trading (assigning the
     * next fiscal_day_no), without necessarily having told ZIMRA yet — the
     * actual openDay call can lag behind while offline (§2.2/§9 rule 10) as
     * long as it lands before any receipt does. Safe to call repeatedly.
     */
    public function ensureDayOpenLocally(FiscalDevice $device): FiscalDay
    {
        return DB::transaction(function () use ($device) {
            $device = FiscalDevice::whereKey($device->id)->lockForUpdate()->firstOrFail();

            $current = $device->currentFiscalDay();
            if ($current) {
                return $current;
            }

            $lastDayNo = FiscalDay::where('fiscal_device_id', $device->id)->max('fiscal_day_no');

            return FiscalDay::create([
                'fiscal_device_id' => $device->id,
                'fiscal_day_no' => ($lastDayNo ?? 0) + 1,
                'status' => 'opened',
                'opened_at' => now(),
                'counters' => [],
            ]);
        });
    }

    /** Sends the (possibly delayed) openDay call for a locally-opened day that hasn't reached ZIMRA yet. */
    public function sendPendingDayOpen(FiscalDevice $device, FiscalDay $day): void
    {
        if ($day->opened_remotely_at) {
            return;
        }

        $response = $this->client($device)->openDay($day->opened_at->format('Y-m-d\TH:i:s'), $day->fiscal_day_no);

        $day->update([
            'fiscal_day_no' => $response['fiscalDayNo'] ?? $day->fiscal_day_no,
            'opened_remotely_at' => now(),
        ]);
    }

    /**
     * Closes a fiscal day: builds the fiscal-day device signature from its
     * accumulated counters (§13.3.1), calls closeDay, then polls getStatus
     * once to record the immediate result. A "close_failed" day can be
     * retried later (unlimited times, per §2.3) — this method is safe to
     * call again for the same day.
     */
    public function closeDay(FiscalDevice $device, FiscalDay $day): FiscalDay
    {
        if (! $day->opened_remotely_at) {
            $this->sendPendingDayOpen($device, $day);
        }

        $counterList = $this->counterListForSignature($day);
        $input = $this->crypto->buildFiscalDaySignatureInput(
            deviceId: $device->device_id,
            fiscalDayNo: $day->fiscal_day_no,
            fiscalDayDate: $day->opened_at->format('Y-m-d'),
            counters: $counterList,
        );
        $signature = [
            'hash' => $this->crypto->hash($input),
            'signature' => $this->crypto->sign($input, $device->private_key),
        ];

        $day->update(['status' => 'close_initiated', 'device_signature' => $input]);

        try {
            $this->client($device)->closeDay([
                'fiscalDayNo' => $day->fiscal_day_no,
                'fiscalDayCounters' => $this->countersForApi($day),
                'fiscalDayDeviceSignature' => $signature,
                'receiptCounter' => $day->last_receipt_counter,
            ]);
        } catch (\Throwable $e) {
            $day->update(['status' => 'close_failed', 'closing_error_code' => $e->getMessage()]);
            Log::warning('ZIMRA closeDay failed', ['fiscal_day_id' => $day->id, 'error' => $e->getMessage()]);

            return $day->fresh();
        }

        try {
            $status = $this->client($device)->getStatus();
            $day->update([
                'status' => match ($status['fiscalDayStatus'] ?? null) {
                    'FiscalDayClosed' => 'closed',
                    'FiscalDayCloseFailed' => 'close_failed',
                    default => 'close_initiated',
                },
                'closing_error_code' => $status['fiscalDayClosingErrorCode'] ?? null,
                'server_signature' => $status['fiscalDayServerSignature'] ?? null,
                'closed_at' => isset($status['fiscalDayClosed']) ? Carbon::parse($status['fiscalDayClosed']) : now(),
            ]);
        } catch (\Throwable $e) {
            // closeDay was accepted even if this status poll failed — leave as
            // close_initiated, the sync job will check again later.
            Log::warning('ZIMRA getStatus after closeDay failed', ['fiscal_day_id' => $day->id, 'error' => $e->getMessage()]);
        }

        return $day->fresh();
    }

    /** @return array<int, array{type: string, currency: string, percent_or_money_type: string|float|null, value: float}> */
    private function counterListForSignature(FiscalDay $day): array
    {
        $rows = collect($day->counters ?? [])->filter(fn ($c) => round((float) $c['value'], 2) !== 0.0);

        // See ZimraCryptoService::buildFiscalDaySignatureInput()'s note on ordering.
        return $rows->sortBy([
            ['type', 'asc'],
            [fn ($c) => $c['tax_id'] ?? $c['money_type'] ?? '', 'asc'],
            ['currency', 'asc'],
        ])->map(fn ($c) => [
            'type' => $c['type'],
            'currency' => $c['currency'],
            'percent_or_money_type' => $c['money_type'] ?? $c['tax_percent'],
            'value' => (float) $c['value'],
        ])->values()->all();
    }

    /** @return array Zero-filtered fiscalDayCounters shaped for the closeDay request body. */
    private function countersForApi(FiscalDay $day): array
    {
        return collect($day->counters ?? [])
            ->filter(fn ($c) => round((float) $c['value'], 2) !== 0.0)
            ->map(fn ($c) => array_filter([
                'fiscalCounterType' => $c['type'],
                'fiscalCounterCurrency' => $c['currency'],
                'fiscalCounterTaxID' => $c['tax_id'] ?? null,
                'fiscalCounterTaxPercent' => $c['tax_percent'] ?? null,
                'fiscalCounterMoneyType' => $c['money_type'] ?? null,
                'fiscalCounterValue' => round((float) $c['value'], 2),
            ], fn ($v) => $v !== null))
            ->values()->all();
    }
}
