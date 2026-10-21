<?php

namespace App\Services\GoFiscal;

use App\Models\Setting;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;

/**
 * The GoFiscal engine's API (https://api.gofiscal.app): send a receipt as
 * JSON, get it back numbered, signed and registered with ZIMRA. Every call
 * carries the company's API key, which is kept encrypted in settings and
 * only ever used here, on the server — never handed to a browser.
 */
class GoFiscalClient
{
    public const KEY_SETTING = 'gofiscal_api_key';

    private ?string $key;

    public function __construct(?string $key = null)
    {
        $this->key = $key ?? self::storedKey();
    }

    public static function storedKey(): ?string
    {
        $stored = Setting::get(self::KEY_SETTING);
        if (! $stored) {
            return null;
        }
        try {
            return Crypt::decryptString($stored);
        } catch (DecryptException) {
            return null; // saved under another APP_KEY — set it again
        }
    }

    public static function storeKey(string $key): void
    {
        Setting::set(self::KEY_SETTING, Crypt::encryptString($key), 'gofiscal');
    }

    public function configured(): bool
    {
        return (bool) $this->key;
    }

    /** The company the key belongs to. */
    public function me(): array
    {
        return $this->send('get', '/v1/me', [], 30)['body'];
    }

    /** The company's devices: deviceId, label, environment (test | prod), active. */
    public function devices(): array
    {
        $body = $this->send('get', '/v1/devices', [], 30)['body'];

        return array_is_list($body) ? $body : (array) ($body['devices'] ?? $body['data'] ?? []);
    }

    /** Fiscal day state, queued count, blocked, certificate days left — $refresh asks ZIMRA live. */
    public function status(int $deviceId, bool $refresh = false): array
    {
        return $this->send('get', "/v1/devices/{$deviceId}/status", $refresh ? ['refresh' => 1] : [], 50)['body'];
    }

    public function closeDay(int $deviceId, int $timeout = 50): array
    {
        return $this->send('post', "/v1/devices/{$deviceId}/day/close", [], $timeout)['body'];
    }

    /**
     * Submits one receipt. 200 is accepted by ZIMRA (or a duplicate of an
     * invoiceNo already sent, with that receipt), 202 numbered and signed but
     * queued for ZIMRA — both come back with the code and QR link to print.
     *
     * @return array{http: int, body: array}
     */
    public function submitReceipt(int $deviceId, array $receipt, int $timeout): array
    {
        return $this->send('post', "/v1/devices/{$deviceId}/receipts", ['receipt' => $receipt], $timeout);
    }

    /** @return array{http: int, body: array} */
    private function send(string $method, string $path, array $data, int $timeout): array
    {
        if (! $this->key) {
            throw new GoFiscalException(0, 'not_configured', 'No GoFiscal API key is set — add it in Settings › ZIMRA Fiscalisation.');
        }

        $request = Http::withToken($this->key)->acceptJson()->connectTimeout(10)->timeout($timeout);
        $url = rtrim((string) config('services.gofiscal.url'), '/') . $path;

        try {
            $response = $method === 'get'
                ? $request->get($url, $data)
                : $request->withBody(json_encode($data ?: new \stdClass()), 'application/json')->post($url);
        } catch (ConnectionException $e) {
            throw new GoFiscalException(0, 'unreachable', 'Could not reach GoFiscal: ' . $e->getMessage());
        }

        $body = $response->json();
        $body = is_array($body) ? $body : [];
        if (! $response->successful()) {
            throw GoFiscalException::fromResponse($response->status(), $body);
        }

        return ['http' => $response->status(), 'body' => $body];
    }
}
