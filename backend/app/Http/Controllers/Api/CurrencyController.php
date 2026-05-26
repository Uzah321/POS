<?php

namespace App\Http\Controllers\Api;

use App\Models\Currency;
use Illuminate\Http\Request;

class CurrencyController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse
    {
        return $this->success(Currency::where('is_active', true)->orderBy('code')->get());
    }

    public function all(): \Illuminate\Http\JsonResponse
    {
        return $this->success(Currency::orderBy('code')->get());
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'code'          => 'required|string|max:10|unique:currencies',
            'name'          => 'required|string|max:100',
            'symbol'        => 'required|string|max:10',
            'exchange_rate' => 'required|numeric|min:0.000001',
            'is_default'    => 'boolean',
            'is_active'     => 'boolean',
        ]);

        if (! empty($data['is_default'])) {
            Currency::where('is_default', true)->update(['is_default' => false]);
        }

        $currency = Currency::create($data);
        return $this->success($currency, 'Currency created', 201);
    }

    public function update(Request $request, Currency $currency): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'code'          => 'sometimes|string|max:10|unique:currencies,code,' . $currency->id,
            'name'          => 'sometimes|string|max:100',
            'symbol'        => 'sometimes|string|max:10',
            'exchange_rate' => 'sometimes|numeric|min:0.000001',
            'is_default'    => 'boolean',
            'is_active'     => 'boolean',
        ]);

        if (! empty($data['is_default'])) {
            Currency::where('is_default', true)->where('id', '!=', $currency->id)->update(['is_default' => false]);
        }

        $currency->update($data);
        return $this->success($currency, 'Currency updated');
    }

    public function destroy(Currency $currency): \Illuminate\Http\JsonResponse
    {
        if ($currency->is_default) {
            return $this->error('Cannot delete the default currency', 422);
        }
        $currency->delete();
        return $this->success(null, 'Currency deleted');
    }
}
