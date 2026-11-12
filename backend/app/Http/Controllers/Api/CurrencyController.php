<?php

namespace App\Http\Controllers\Api;

use App\Models\Currency;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The shop's currencies. Every amount is kept in the base currency (USD), and
 * each rate is units of a currency per 1 USD — so USD's rate is always 1 and
 * USD can't be removed. Exactly one currency is the default (the one tills and
 * screens open in), and it is always active.
 */
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
        if ($request->filled('code')) {
            $request->merge(['code' => strtoupper(trim((string) $request->code))]);
        }
        $data = $request->validate([
            'code'          => 'required|string|max:10|unique:currencies',
            'name'          => 'required|string|max:100',
            'symbol'        => 'required|string|max:10',
            'exchange_rate' => 'required|numeric|min:0.000001',
            'is_default'    => 'boolean',
            'is_active'     => 'boolean',
        ]);

        if ($data['code'] === Currency::BASE) {
            $data['exchange_rate'] = 1;
        }
        if (! empty($data['is_default'])) {
            $data['is_active'] = true; // the default is always usable
        }

        $currency = DB::transaction(function () use ($data) {
            if (! empty($data['is_default'])) {
                Currency::where('is_default', true)->update(['is_default' => false]);
            }
            return Currency::create($data);
        });

        return $this->success($currency, 'Currency created', 201);
    }

    public function update(Request $request, Currency $currency): \Illuminate\Http\JsonResponse
    {
        if ($request->filled('code')) {
            $request->merge(['code' => strtoupper(trim((string) $request->code))]);
        }
        $data = $request->validate([
            'code'          => 'sometimes|string|max:10|unique:currencies,code,' . $currency->id,
            'name'          => 'sometimes|string|max:100',
            'symbol'        => 'sometimes|string|max:10',
            'exchange_rate' => 'sometimes|numeric|min:0.000001',
            'is_default'    => 'boolean',
            'is_active'     => 'boolean',
        ]);

        $isBase = $currency->code === Currency::BASE;
        if ($isBase && isset($data['code']) && $data['code'] !== Currency::BASE) {
            return $this->error(Currency::BASE . ' is the base currency — its code can\'t be changed.', 422);
        }
        if (! $isBase && ($data['code'] ?? null) === Currency::BASE) {
            return $this->error(Currency::BASE . ' is the base currency and already exists.', 422);
        }
        if ($isBase) {
            $data['exchange_rate'] = 1; // everything is measured against it
        }

        $willBeDefault = array_key_exists('is_default', $data) ? (bool) $data['is_default'] : (bool) $currency->is_default;
        if ($currency->is_default && ! $willBeDefault) {
            return $this->error('This is the default currency. To change the default, make another currency the default.', 422);
        }
        if ($willBeDefault) {
            if (array_key_exists('is_active', $data) && ! $data['is_active']) {
                return $this->error('The default currency can\'t be switched off. Make another currency the default first.', 422);
            }
            $data['is_active'] = true;
        }

        DB::transaction(function () use ($currency, $data, $willBeDefault) {
            if ($willBeDefault && ! $currency->is_default) {
                Currency::where('is_default', true)->where('id', '!=', $currency->id)->update(['is_default' => false]);
            }
            $currency->update($data);
        });

        return $this->success($currency->fresh(), 'Currency updated');
    }

    public function destroy(Currency $currency): \Illuminate\Http\JsonResponse
    {
        if ($currency->code === Currency::BASE) {
            return $this->error(Currency::BASE . ' is the base currency and can\'t be deleted.', 422);
        }
        if ($currency->is_default) {
            return $this->error('Cannot delete the default currency', 422);
        }
        $currency->delete();
        return $this->success(null, 'Currency deleted');
    }
}
