<?php

namespace App\Http\Controllers\Api;

use App\Models\FiscalDevice;
use App\Models\FiscalTaxMapping;
use App\Models\Register;
use App\Services\Zimra\FiscalDeviceService;
use App\Services\Zimra\FiscalSubmissionService;
use App\Services\Zimra\ZimraApiException;
use Illuminate\Http\Request;

class FiscalController extends BaseApiController
{
    public function __construct(
        private readonly FiscalDeviceService $deviceService,
        private readonly FiscalSubmissionService $submissionService,
    ) {
    }

    public function verifyTaxpayer(Request $request, Register $register): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'device_id' => 'required|integer',
            'activation_key' => 'required|string|max:8',
            'device_serial_no' => 'required|string|max:20',
            'environment' => 'required|in:test,live',
        ]);

        $device = $register->fiscalDevice ?? new FiscalDevice(['register_id' => $register->id]);
        $device->environment = $data['environment'];

        try {
            $result = $this->deviceService->verifyTaxpayer($device, $data['device_id'], $data['activation_key'], $data['device_serial_no']);
        } catch (ZimraApiException $e) {
            return $this->error($e->getMessage(), 422, ['errorCode' => $e->errorCode]);
        }

        return $this->success($result);
    }

    public function registerDevice(Request $request, Register $register): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'device_id' => 'required|integer',
            'activation_key' => 'required|string|max:8',
            'device_serial_no' => 'required|string|max:20',
            'environment' => 'required|in:test,live',
            'key_algorithm' => 'nullable|in:ecc,rsa',
        ]);

        $device = $register->fiscalDevice ?? new FiscalDevice(['register_id' => $register->id]);
        $device->environment = $data['environment'];
        if (! $device->exists) {
            $device->save();
        }

        try {
            $device = $this->deviceService->register(
                $device,
                $data['device_id'],
                $data['activation_key'],
                $data['device_serial_no'],
                $data['key_algorithm'] ?? 'ecc',
            );
        } catch (ZimraApiException $e) {
            return $this->error($e->getMessage(), 422, ['errorCode' => $e->errorCode]);
        }

        return $this->success($device->load('taxMappings'), 'Device registered with ZIMRA');
    }

    public function refreshConfig(FiscalDevice $fiscalDevice): \Illuminate\Http\JsonResponse
    {
        try {
            $device = $this->deviceService->refreshConfig($fiscalDevice);
        } catch (ZimraApiException $e) {
            return $this->error($e->getMessage(), 422, ['errorCode' => $e->errorCode]);
        }

        return $this->success($device->load('taxMappings'), 'Configuration refreshed');
    }

    public function renewCertificate(Request $request, FiscalDevice $fiscalDevice): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['key_algorithm' => 'nullable|in:ecc,rsa']);

        try {
            $device = $this->deviceService->renewCertificate($fiscalDevice, $data['key_algorithm'] ?? $fiscalDevice->key_algorithm);
        } catch (ZimraApiException $e) {
            return $this->error($e->getMessage(), 422, ['errorCode' => $e->errorCode]);
        }

        return $this->success($device, 'Certificate renewed');
    }

    public function updateTaxMapping(Request $request, FiscalTaxMapping $fiscalTaxMapping): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['local_tax_rate_id' => 'nullable|exists:tax_rates,id']);
        $fiscalTaxMapping->update($data);

        return $this->success($fiscalTaxMapping, 'Tax mapping updated');
    }

    public function openDay(FiscalDevice $fiscalDevice): \Illuminate\Http\JsonResponse
    {
        $day = $this->deviceService->ensureDayOpenLocally($fiscalDevice);

        try {
            $this->deviceService->sendPendingDayOpen($fiscalDevice, $day);
        } catch (ZimraApiException $e) {
            // Day is still open locally — this just couldn't reach ZIMRA yet;
            // the sync retry will pick it up before the first receipt goes out.
            return $this->success($day->fresh(), 'Fiscal day opened locally — will notify ZIMRA once reachable ('.$e->getMessage().')');
        }

        return $this->success($day->fresh(), 'Fiscal day opened');
    }

    public function closeDay(FiscalDevice $fiscalDevice): \Illuminate\Http\JsonResponse
    {
        $day = $fiscalDevice->currentFiscalDay();
        if (! $day) {
            return $this->error('No open fiscal day to close.', 422);
        }

        $day = $this->deviceService->closeDay($fiscalDevice, $day);

        return $this->success($day, match ($day->status) {
            'closed' => 'Fiscal day closed',
            'close_failed' => 'Fiscal day close failed — see closing_error_code',
            default => 'Fiscal day close is being processed',
        });
    }

    public function status(FiscalDevice $fiscalDevice): \Illuminate\Http\JsonResponse
    {
        return $this->success([
            'device' => $fiscalDevice->only([
                'id', 'device_id', 'status', 'environment', 'operating_mode',
                'certificate_valid_till', 'next_receipt_global_no', 'last_error',
            ]),
            'current_fiscal_day' => $fiscalDevice->currentFiscalDay(),
        ]);
    }

    /** Retries every pending/failed fiscal receipt for a branch — called by the frontend's existing offline-sync poll. */
    public function sync(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = (int) ($request->branch_id ?? $request->user()->branch_id);
        if (! $branchId) {
            return $this->success(['submitted' => 0, 'still_pending' => 0]);
        }

        return $this->success($this->submissionService->retryPendingForBranch($branchId));
    }
}
