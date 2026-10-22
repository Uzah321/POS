<?php

namespace App\Http\Controllers\Api;

use App\Models\Branch;
use App\Models\RestaurantTable;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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
                    'waiter_id'   => $openSale->waiter_id,
                    'waiter_name' => $openSale->waiter?->name,
                    'opened_at'   => $openSale->created_at,
                ] : null,
            ];
        });

        return $this->success($result);
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate(['branch_id' => 'nullable|exists:branches,id']);
        $branchId = $this->branchForNewTable($request);
        if (! $branchId) {
            return $this->error('Add a branch first (Settings › Branches) — every table belongs to one.', 422);
        }

        $data = $request->validate([
            'name'       => ['required', 'string', 'max:50', $this->uniqueName($branchId)],
            'seats'      => 'nullable|integer|min:1',
            'sort_order' => 'nullable|integer|min:0',
        ], ['name.unique' => 'There is already a table with that name.']);

        // Blank seats / order keep their defaults (2, 0) — the columns take no null.
        $table = RestaurantTable::create(array_filter($data, fn ($v) => $v !== null) + ['branch_id' => $branchId, 'seats' => 2]);

        return $this->success($table, 'Table created', 201);
    }

    /**
     * The branch a new table goes in. An admin can say which; anyone else
     * gets their own. Staff with no branch (allowed for admins and managers)
     * get the main branch — the screen used to send none for them, or a
     * branch id that didn't exist, and every new table was refused.
     */
    private function branchForNewTable(Request $request): ?int
    {
        $user = $request->user();
        if ($user->branch_id && ! $user->hasRole('admin')) {
            return $user->branch_id;
        }

        return $request->integer('branch_id') ?: $user->branch_id
            ?: Branch::where('is_main', true)->value('id')
            ?: Branch::orderBy('id')->value('id');
    }

    /** Two tables called "Table 4" in one branch can't be told apart on the floor plan or the kitchen ticket. */
    private function uniqueName(int $branchId, ?RestaurantTable $ignore = null): \Illuminate\Validation\Rules\Unique
    {
        return Rule::unique('restaurant_tables', 'name')->where('branch_id', $branchId)->ignore($ignore?->id);
    }

    public function update(Request $request, RestaurantTable $table): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'       => ['sometimes', 'string', 'max:50', $this->uniqueName($table->branch_id, $table)],
            'seats'      => 'nullable|integer|min:1',
            'sort_order' => 'nullable|integer|min:0',
            'is_active'  => 'sometimes|boolean',
        ], ['name.unique' => 'There is already a table with that name.']);

        $table->update(array_filter($data, fn ($v) => $v !== null));

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
