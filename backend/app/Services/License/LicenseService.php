<?php

namespace App\Services\License;

use App\Models\License;
use App\Models\Setting;
use Illuminate\Support\Facades\Http;

class LicenseService
{
    /** Setting key holding the last signed answer from the license server. */
    private const STATE_KEY = 'license_state';
    private const KEY_KEY = 'license_key';

    // ── Server side ──────────────────────────────────────────────────────

    /** Sign a license's current state. The client can verify this but not forge it. */
    public function signedPayload(License $license): array
    {
        $payload = json_encode([
            'client'     => $license->client_name,
            'status'     => $license->status,
            'expires_at' => $license->expires_at->toIso8601String(),
            'issued_at'  => now()->toIso8601String(),
        ]);

        $private = @file_get_contents(config('license.private_key_path'));
        if (! $private || ! openssl_sign($payload, $signature, $private, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('License signing key is missing or invalid. Run: php artisan license:keygen');
        }

        return ['payload' => $payload, 'signature' => base64_encode($signature)];
    }

    // ── Client side ──────────────────────────────────────────────────────

    /** True only if the signature was made by the vendor's private key. */
    public function verify(string $payload, string $signature): bool
    {
        $public = @file_get_contents(config('license.public_key_path'));
        if (! $public) {
            return false;
        }
        return openssl_verify($payload, base64_decode($signature, true) ?: '', $public, OPENSSL_ALGO_SHA256) === 1;
    }

    public function storedKey(): ?string
    {
        return Setting::get(self::KEY_KEY) ?: null;
    }

    /** Ask the server about $key and store its signed answer. Throws on a rejected key. */
    public function activate(string $key): array
    {
        $response = Http::timeout(10)->acceptJson()
            ->post(config('license.server_url') . '/api/license/check', ['key' => $key]);

        if ($response->status() === 404) {
            throw new \InvalidArgumentException('License key not recognised.');
        }
        $response->throw();

        $data = $response->json('data');
        if (! $this->verify($data['payload'] ?? '', $data['signature'] ?? '')) {
            throw new \RuntimeException('License server response failed signature check.');
        }

        Setting::set(self::KEY_KEY, $key, 'license');
        Setting::set(self::STATE_KEY, json_encode([
            'payload'      => $data['payload'],
            'signature'    => $data['signature'],
            'checked_at'   => now()->toIso8601String(),
            'last_seen_at' => now()->toIso8601String(),
        ]), 'license');

        return $this->status();
    }

    /** Re-check with the server if it's been a while. Offline is fine: the stored answer keeps working until it expires. */
    public function refreshIfStale(): void
    {
        $key = $this->storedKey();
        $state = $this->state();
        if (! $key || ! $state) {
            return;
        }
        $checkedAt = \Carbon\Carbon::parse($state['checked_at'] ?? '2000-01-01');
        if ($checkedAt->gt(now()->subHours(config('license.refresh_hours')))) {
            return;
        }
        try {
            $this->activate($key);
        } catch (\Throwable) {
            // Offline or server down — keep the last signed answer.
        }
    }

    private function state(): ?array
    {
        $raw = Setting::get(self::STATE_KEY);
        return $raw ? json_decode($raw, true) : null;
    }

    /**
     * Current license standing. state is one of:
     * unlicensed | valid | expiring | expired | revoked | invalid
     */
    public function status(): array
    {
        $base = ['enforced' => (bool) config('license.enforce'), 'state' => 'unlicensed', 'client' => null, 'expires_at' => null, 'days_left' => null];

        $state = $this->state();
        if (! $state) {
            return $base;
        }
        // A tampered or foreign payload never counts as a license.
        if (! $this->verify($state['payload'] ?? '', $state['signature'] ?? '')) {
            return ['state' => 'invalid'] + $base;
        }

        $payload = json_decode($state['payload'], true);
        $expires = \Carbon\Carbon::parse($payload['expires_at']);
        $base['client'] = $payload['client'] ?? null;
        $base['expires_at'] = $expires->toIso8601String();

        // Winding the system clock back can't extend a license: if "now" is
        // earlier than the last time we saw, treat it as expired.
        $lastSeen = \Carbon\Carbon::parse($state['last_seen_at'] ?? '2000-01-01');
        $clockRolledBack = now()->lt($lastSeen->copy()->subDay());
        if (! $clockRolledBack && now()->gt($lastSeen->copy()->addHour())) {
            $state['last_seen_at'] = now()->toIso8601String();
            Setting::set(self::STATE_KEY, json_encode($state), 'license');
        }

        $base['days_left'] = (int) floor(now()->diffInDays($expires, false));

        if (($payload['status'] ?? 'active') === 'revoked') {
            $base['state'] = 'revoked';
        } elseif ($clockRolledBack || $expires->isPast()) {
            $base['state'] = 'expired';
        } elseif (now()->diffInDays($expires, false) <= config('license.warn_days')) {
            $base['state'] = 'expiring';
        } else {
            $base['state'] = 'valid';
        }

        return $base;
    }

    /** Can this install still make changes (sell, edit)? Always true when enforcement is off. */
    public function allowsWrites(): bool
    {
        if (! config('license.enforce')) {
            return true;
        }
        return in_array($this->status()['state'], ['valid', 'expiring'], true);
    }
}
