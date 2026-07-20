<?php

namespace App\Http\Controllers\Api;

use App\Models\Branch;
use App\Models\Ingredient;
use App\Models\IngredientStock;
use App\Models\Warehouse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class IngredientController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = Ingredient::with('unit')
            ->withSum('stocks', 'quantity')
            ->when($request->search, function ($q) use ($request) {
                $s = '%' . mb_strtolower($request->search) . '%';
                $q->where(function ($q) use ($s) {
                    $q->whereRaw('LOWER(name) LIKE ?', [$s])
                      ->orWhereRaw('LOWER(sku) LIKE ?', [$s])
                      ->orWhereRaw('LOWER(barcode) LIKE ?', [$s]);
                });
            })
            ->when(isset($request->is_active), fn($q) => $q->where('is_active', $request->boolean('is_active')));

        return $this->paginated($query->orderBy('name')->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'              => 'required|string|max:255',
            'sku'               => 'nullable|string',
            'barcode'           => 'nullable|string',
            'unit_id'           => 'nullable|exists:units,id',
            'conversion_number' => 'nullable|numeric|min:0',
            'stock_unit'        => 'nullable|string|max:255',
            'cost_price'        => 'nullable|numeric|min:0',
            'is_active'         => 'boolean',
            'initial_quantity'  => 'nullable|numeric|min:0',
        ]);

        $initialQty = (float) ($data['initial_quantity'] ?? 0);
        unset($data['initial_quantity']);

        $ingredient = DB::transaction(function () use ($data, $initialQty) {
            $ingredient = Ingredient::create($data);

            if ($initialQty > 0) {
                $warehouse = Warehouse::where('is_default', true)->first() ?? Warehouse::first();
                if ($warehouse) {
                    IngredientStock::create([
                        'ingredient_id' => $ingredient->id,
                        'warehouse_id'  => $warehouse->id,
                        'quantity'      => $initialQty,
                    ]);
                }
            }

            return $ingredient;
        });

        return $this->success($ingredient->load('unit')->loadSum('stocks', 'quantity'), 'Ingredient created', 201);
    }

    public function show(Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        return $this->success(
            $ingredient->load('unit', 'vendors.supplier', 'branchSettings.branch', 'stocks.warehouse')
                ->loadSum('stocks', 'quantity')
        );
    }

    public function update(Request $request, Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'              => 'sometimes|string|max:255',
            'sku'               => 'nullable|string',
            'barcode'           => 'nullable|string',
            'unit_id'           => 'nullable|exists:units,id',
            'conversion_number' => 'nullable|numeric|min:0',
            'stock_unit'        => 'nullable|string|max:255',
            'cost_price'        => 'sometimes|numeric|min:0',
            'is_active'         => 'boolean',
        ]);

        $ingredient->update($data);

        return $this->success($ingredient->load('unit')->loadSum('stocks', 'quantity'), 'Ingredient updated');
    }

    public function destroy(Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        $ingredient->delete();
        return $this->success(null, 'Ingredient deleted');
    }

    /** Vendors tab — which suppliers carry this ingredient. */
    public function vendors(Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        return $this->success($ingredient->vendors()->with('supplier:id,name,company_name')->get());
    }

    /** Replace the full vendor list for this ingredient. */
    public function syncVendors(Request $request, Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'vendors'                    => 'present|array',
            'vendors.*.supplier_id'      => 'required|exists:suppliers,id',
            'vendors.*.vendor_sku'       => 'nullable|string',
            'vendors.*.vendor_cost'      => 'nullable|numeric|min:0',
        ]);

        DB::transaction(function () use ($ingredient, $data) {
            $ingredient->vendors()->delete();
            foreach ($data['vendors'] as $row) {
                $ingredient->vendors()->create([
                    'supplier_id' => $row['supplier_id'],
                    'vendor_sku'  => $row['vendor_sku'] ?? null,
                    'vendor_cost' => $row['vendor_cost'] ?? null,
                ]);
            }
        });

        return $this->success($ingredient->vendors()->with('supplier:id,name,company_name')->get(), 'Vendors updated');
    }

    /** Ordering tab — every branch's recommended/minimum reorder quantity plus its live stock quantity. */
    public function ordering(Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        $settings = $ingredient->branchSettings()->get()->keyBy('branch_id');
        $stockByWarehouseBranch = IngredientStock::where('ingredient_id', $ingredient->id)
            ->with('warehouse:id,branch_id')
            ->get()
            ->groupBy(fn($s) => $s->warehouse?->branch_id)
            ->map(fn($rows) => $rows->sum('quantity'));

        $rows = Branch::orderBy('name')->get(['id', 'name'])->map(function ($branch) use ($settings, $stockByWarehouseBranch) {
            $setting = $settings->get($branch->id);
            return [
                'branch_id'            => $branch->id,
                'branch_name'          => $branch->name,
                'recommended_quantity' => $setting->recommended_quantity ?? 0,
                'minimum_quantity'     => $setting->minimum_quantity ?? 0,
                'quantity'             => (float) ($stockByWarehouseBranch->get($branch->id) ?? 0),
            ];
        });

        return $this->success([
            'rows' => $rows,
            'total_recommended_quantity' => $rows->sum('recommended_quantity'),
            'total_minimum_quantity' => $rows->sum('minimum_quantity'),
            'total_quantity' => (float) $ingredient->total_stock,
        ]);
    }

    /** Replace the full per-branch ordering settings for this ingredient. */
    public function syncOrdering(Request $request, Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'settings'                          => 'present|array',
            'settings.*.branch_id'               => 'required|exists:branches,id',
            'settings.*.recommended_quantity'    => 'nullable|integer|min:0',
            'settings.*.minimum_quantity'         => 'nullable|integer|min:0',
        ]);

        DB::transaction(function () use ($ingredient, $data) {
            foreach ($data['settings'] as $row) {
                $ingredient->branchSettings()->updateOrCreate(
                    ['branch_id' => $row['branch_id']],
                    [
                        'recommended_quantity' => $row['recommended_quantity'] ?? 0,
                        'minimum_quantity'     => $row['minimum_quantity'] ?? 0,
                    ]
                );
            }
        });

        return $this->ordering($ingredient);
    }
}
