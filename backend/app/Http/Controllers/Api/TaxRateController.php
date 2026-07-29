<?php

namespace App\Http\Controllers\Api;

use App\Models\TaxRate;

class TaxRateController extends BaseApiController
{
    /** Read-only — used to populate the ZIMRA tax-mapping dropdown in Settings; Core has no tax-rate management UI beyond that today. */
    public function index(): \Illuminate\Http\JsonResponse
    {
        return $this->success(TaxRate::orderBy('name')->get());
    }
}
