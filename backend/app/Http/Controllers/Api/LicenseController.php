<?php

namespace App\Http\Controllers\Api;

use App\Models\License;
use App\Services\License\LicenseService;
use Illuminate\Http\Request;

class LicenseController extends BaseApiController
{
    public function __construct(private LicenseService $service) {}

    // ── Vendor server ────────────────────────────────────────────────────

    /** Public check-in: a client sends its key, gets back a signed statement of its license. */
    public function check(Request $request)
    {
        if (! config('license.server_enabled')) {
            return $this->error('This server does not issue licenses.', 404);
        }
        $data = $request->validate(['key' => 'required|string|max:100']);

        $license = License::where('key', strtoupper(trim($data['key'])))->first();
        if (! $license) {
            return $this->error('License key not recognised.', 404);
        }
        $license->update(['last_seen_at' => now(), 'last_seen_ip' => $request->ip()]);

        return $this->success($this->service->signedPayload($license));
    }

    public function index()
    {
        $this->requireServer();
        return $this->success(License::orderBy('expires_at')->get());
    }

    public function store(Request $request)
    {
        $this->requireServer();
        $data = $request->validate(['client_name' => 'required|string|max:150', 'months' => 'nullable|integer|min:1|max:24', 'notes' => 'nullable|string']);

        $license = License::create([
            'key'         => License::generateKey(),
            'client_name' => $data['client_name'],
            'expires_at'  => now()->addMonthsNoOverflow($data['months'] ?? 1),
            'notes'       => $data['notes'] ?? null,
        ]);

        return $this->success($license, 'License issued', 201);
    }

    public function renew(Request $request, License $license)
    {
        $this->requireServer();
        $license->renew((int) $request->input('months', 1));
        return $this->success($license->fresh(), 'License renewed');
    }

    public function revoke(License $license)
    {
        $this->requireServer();
        $license->update(['status' => 'revoked']);
        return $this->success($license->fresh(), 'License revoked');
    }

    // ── This install ─────────────────────────────────────────────────────

    public function status()
    {
        $this->service->refreshIfStale();
        return $this->success($this->service->status() + ['server_enabled' => (bool) config('license.server_enabled')]);
    }

    public function activate(Request $request)
    {
        $data = $request->validate(['key' => 'required|string|max:100']);

        try {
            return $this->success($this->service->activate(strtoupper(trim($data['key']))), 'License activated');
        } catch (\InvalidArgumentException $e) {
            return $this->error($e->getMessage(), 422);
        } catch (\Throwable $e) {
            return $this->error('Could not reach the license server. Check the internet connection and try again.', 503);
        }
    }

    private function requireServer(): void
    {
        abort_unless(config('license.server_enabled'), 404);
    }
}
