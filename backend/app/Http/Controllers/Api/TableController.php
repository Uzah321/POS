<?php

namespace App\Http\Controllers\Api;

use App\Models\RestaurantTable;
use Illuminate\Http\Request;

class TableController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);

        $tables = RestaurantTable::query()
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->where('is_active', true)
            ->with(['sales' => fn ($q) => $q->where('status', 'open')->with('waiter:id,name')->latest()->limit(1)])
            ->orderBy('sort_order')->orderBy('name')
            ->get();

        $result = $tables->map(function (RestaurantTable $table) {
            $openSale = $table->sales->first();
            return [
                'id'     => $table->id,
                'name'   => $table->name,
                'seats'  => $table->seats,
                'open_sale' => $openSale ? [
                    'id'          => $openSale->id,
                    'reference'   => $openSale->reference,
                    'total'       => $openSale->total,
                    'waiter_name' => $openSale->waiter?->name,
                    'opened_at'   => $openSale->created_at,
                ] : null,
            ];
        });

        return $this->success($result);
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'branch_id'  => 'required|exists:branches,id',
            'name'       => 'required|string|max:50',
            'seats'      => 'nullable|integer|min:1',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $table = RestaurantTable::create($data);

        return $this->success($table, 'Table created', 201);
    }

    public function update(Request $request, RestaurantTable $table): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'       => 'sometimes|string|max:50',
            'seats'      => 'nullable|integer|min:1',
            'sort_order' => 'nullable|integer|min:0',
            'is_active'  => 'sometimes|boolean',
        ]);

        $table->update($data);

        return $this->success($table, 'Table updated');
    }

    public function destroy(RestaurantTable $table): \Illuminate\Http\JsonResponse
    {
        if ($table->sales()->where('status', 'open')->exists()) {
            return $this->error('This table has an open tab — close it before removing the table.', 422);
        }

        $table->delete();

        return $this->success(null, 'Table removed');
    }
}
