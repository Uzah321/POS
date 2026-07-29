<?php

namespace App\Services\Zimra;

use App\Models\FiscalDevice;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Thin wrapper over the ZIMRA Fiscal Device Gateway API v7.2 REST endpoints
 * this integration uses (§4). Deliberately excludes submitFile/getFileStatus
 * (offline device mode — out of scope, see plan), the Users-management
 * endpoints (Core has its own auth), and getStockList.
 *
 * verifyTaxpayerInformation, registerDevice, and getServerCertificate don't
 * require client-certificate auth (§7.3) — every other method does, and will
 * throw if the device has no certificate yet.
 */
class ZimraApiClient
{
    public function __construct(private readonly FiscalDevice $device)
    {
    }

    public function verifyTaxpayerInformation(int $deviceId, string $activationKey, string $deviceSerialNo): array
    {
        return $this->send('verifyTaxpayerInformation', [
            'deviceID' => $deviceId,
            'activationKey' => $activationKey,
            'deviceSerialNo' => $deviceSerialNo,
        ], needsCert: false);
    }

    public function registerDevice(int $deviceId, string $activationKey, string $certificateRequestPem): array
    {
        return $this->send('registerDevice', [
            'deviceID' => $deviceId,
            'activationKey' => $activationKey,
            'certificateRequest' => $certificateRequestPem,
        ], needsCert: false);
    }

    public function issueCertificate(string $certificateRequestPem): array
    {
        return $this->send('issueCertificate', [
            'deviceID' => $this->device->device_id,
            'certificateRequest' => $certificateRequestPem,
        ]);
    }

    public function getConfig(): array
    {
        return $this->send('getConfig', ['deviceID' => $this->device->device_id]);
    }

    public function getStatus(): array
    {
        return $this->send('getStatus', ['deviceID' => $this->device->device_id]);
    }

    public function openDay(string $fiscalDayOpenedIso, ?int $fiscalDayNo = null): array
    {
        $payload = ['deviceID' => $this->device->device_id, 'fiscalDayOpened' => $fiscalDayOpenedIso];
        if ($fiscalDayNo !== null) {
            $payload['fiscalDayNo'] = $fiscalDayNo;
        }

        return $this->send('openDay', $payload);
    }

    public function submitReceipt(array $receipt): array
    {
        return $this->send('submitReceipt', ['deviceID' => $this->device->device_id, 'receipt' => $receipt]);
    }

    public function closeDay(array $payload): array
    {
        $payload['deviceID'] = $this->device->device_id;

        return $this->send('closeDay', $payload);
    }

    public function getServerCertificate(?string $thumbprint = null): array
    {
        return $this->send('getServerCertificate', array_filter(['thumbprint' => $thumbprint]), needsCert: false);
    }

    public function ping(): array
    {
        return $this->send('ping', ['deviceID' => $this->device->device_id]);
    }

    /** Posts $payload to $endpoint and returns the decoded JSON body, or throws ZimraApiException. */
    private function send(string $endpoint, array $payload, bool $needsCert = true): array
    {
        $url = $this->url($endpoint);

        $response = $needsCert
            ? $this->withMtls(fn (PendingRequest $http) => $http->post($url, $payload))
            : $this->baseRequest()->post($url, $payload);

        if (! $response->successful()) {
            throw ZimraApiException::fromResponse($response);
        }

        return $response->json() ?? [];
    }

    private function url(string $endpoint): string
    {
        $base = config("zimra.urls.{$this->device->environment}");

        return rtrim($base, '/')."/{$endpoint}";
    }

    private function baseRequest(): PendingRequest
    {
        return Http::timeout((int) config('zimra.timeout', 30))
            ->withHeaders([
                'DeviceModelName' => config('zimra.device_model_name'),
                'DeviceModelVersionNo' => config('zimra.device_model_version'),
                'Accept' => 'application/json',
            ]);
    }

    /**
     * Materializes the device's certificate + private key to short-lived temp
     * files for the lifetime of a single mTLS request — Guzzle's cert/ssl_key
     * options require file paths, not raw PEM strings. The private key is
     * never persisted decrypted anywhere else (it stays encrypted at rest via
     * FiscalDevice's `encrypted` cast until this exact moment), and the temp
     * files are deleted immediately after the request completes, success or not.
     */
    private function withMtls(\Closure $callback): Response
    {
        if (! $this->device->certificate || ! $this->device->private_key) {
            throw new \RuntimeException('This fiscal device has no certificate yet — register it before calling this endpoint.');
        }

        $dir = 'fiscal/tmp';
        Storage::disk('local')->makeDirectory($dir);
        $prefix = $dir.'/'.Str::uuid();
        $certRelative = "{$prefix}.cert.pem";
        $keyRelative = "{$prefix}.key.pem";

        Storage::disk('local')->put($certRelative, $this->device->certificate);
        Storage::disk('local')->put($keyRelative, $this->device->private_key);
        $certPath = Storage::disk('local')->path($certRelative);
        $keyPath = Storage::disk('local')->path($keyRelative);
        @chmod($keyPath, 0600);

        try {
            return $callback($this->baseRequest()->withOptions(['cert' => $certPath, 'ssl_key' => $keyPath]));
        } finally {
            Storage::disk('local')->delete([$certRelative, $keyRelative]);
        }
    }
}
