<?php

namespace App\Http\Controllers\Api;

use App\Models\GoFiscalReceipt;
use App\Models\Register;
use App\Models\Setting;
use App\Services\GoFiscal\GoFiscalClient;
use App\Services\GoFiscal\GoFiscalException;
use App\Services\GoFiscal\GoFiscalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Settings › ZIMRA Fiscalisation, for GoFiscal: the company's API key (saved
 * only once the engine accepts it, and never sent back — only its last four
 * characters), the HS code for products without one, which engine device each
 * till uses, and the devices' fiscal days. Plus the till's own call to finish
 * a receipt before printing it.
 */
class GoFiscalController extends BaseApiController
{
    public function __construct(private readonly GoFiscalService $service)
    {
    }

    public function show(): JsonResponse
    {
        $key = GoFiscalClient::storedKey();

        return $this->success([
            'configured' => (bool) $key,
            'key_hint' => $key ? substr($key, -4) : null,
            'default_hs_code' => Setting::get('gofiscal_default_hs_code') ?: null,
            'pending' => GoFiscalReceipt::where('status', 'pending')->count(),
            'failed' => GoFiscalReceipt::where('status', 'failed')->count(),
            'problems' => GoFiscalReceipt::whereIn('status', ['pending', 'failed'])->latest('id')->limit(10)
                ->get(['id', 'invoice_no', 'receipt_type', 'status', 'error_code', 'last_error', 'attempts', 'created_at']),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'api_key' => 'nullable|string|max:200',
            'default_hs_code' => ['nullable', 'regex:/^\d{4,8}$/'],
        ], ['default_hs_code.regex' => 'An HS code is 4 to 8 digits.']);

        $company = null;
        if (! empty($data['api_key'])) {
            $key = trim($data['api_key']);
            try {
                $company = (new GoFiscalClient($key))->me();
            } catch (GoFiscalException $e) {
                return $this->error($e->status === 401 ? "GoFiscal didn't accept that API key." : $e->getMessage(), 422);
            }
            GoFiscalClient::storeKey($key);
        }
        if ($request->exists('default_hs_code')) {
            Setting::set('gofiscal_default_hs_code', $data['default_hs_code'] ?? '', 'gofiscal');
        }

        return $this->success(['company' => $company], 'GoFiscal settings saved');
    }

    /** The company the key belongs to and its devices, to link tills to. */
    public function devices(): JsonResponse
    {
        try {
            $client = new GoFiscalClient();
            return $this->success(['company' => $client->me(), 'devices' => $client->devices()]);
        } catch (GoFiscalException $e) {
            return $this->error($e->getMessage(), 422);
        }
    }

    /** Which engine device a till fiscalises through — null stops using GoFiscal on it. */
    public function linkRegister(Request $request, Register $register): JsonResponse
    {
        $data = $request->validate(['device_id' => 'nullable|integer|min:1']);
        $register->update(['gofiscal_device_id' => $data['device_id'] ?? null]);

        return $this->success($register, $register->gofiscal_device_id ? 'Till linked to GoFiscal' : 'Till no longer uses GoFiscal');
    }

    public function status(Request $request, int $device): JsonResponse
    {
        try {
            return $this->success((new GoFiscalClient())->status($device, $request->boolean('refresh')));
        } catch (GoFiscalException $e) {
            return $this->error($e->getMessage(), 422, ['error' => $e->errorCode]);
        }
    }

    /** Opens the device's fiscal day now, rather than with its next sale. */
    public function openDay(int $device): JsonResponse
    {
        try {
            return $this->success((new GoFiscalClient())->openDay($device), 'Fiscal day opened');
        } catch (GoFiscalException $e) {
            return $this->error($e->getMessage(), 422, ['error' => $e->errorCode]);
        }
    }

    public function closeDay(int $device): JsonResponse
    {
        try {
            return $this->success((new GoFiscalClient())->closeDay($device), 'Fiscal day closed');
        } catch (GoFiscalException $e) {
            return $this->error($e->getMessage(), 422, ['error' => $e->errorCode]);
        }
    }

    /** The till finishing a receipt that wasn't through when the sale saved, so it prints with its QR. */
    public function submit(GoFiscalReceipt $goFiscalReceipt): JsonResponse
    {
        $this->service->submit($goFiscalReceipt, GoFiscalService::FOLLOW_UP_TIMEOUT);

        return $this->success($this->service->summary($goFiscalReceipt->fresh()));
    }
}
