<?php

namespace App\Http\Controllers\Api;

use App\Models\Branch;
use App\Models\Ingredient;
use App\Models\IngredientStock;
use App\Models\IngredientStockAdjustment;
use App\Models\Product;
use App\Models\ProductIngredient;
use App\Models\Warehouse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class IngredientController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        // Ingredients are one catalog for both shops. While switched to one side,
        // leave out those only the other side's recipes use (so its out-of-stock
        // alerts don't show here) — but keep every ingredient no recipe uses yet:
        // hiding all of them in supermarket mode meant a butchery or deli there
        // created an ingredient and never saw it again, in this list or in the
        // recipe picker.
        $businessType = $this->effectiveBusinessType($request);

        $query = Ingredient::with('unit')
            ->withSum('stocks', 'quantity')
            ->when($businessType, fn($q) => $q->where(fn($q) => $q
                ->whereDoesntHave('recipeLines.product')
                ->orWhereHas('recipeLines.product', fn($p) => $this->scopeProductsToBusinessType($p, $businessType))
            ))
            ->when($request->search, function ($q) use ($request) {
                $s = '%' . mb_strtolower($request->search) . '%';
                $q->where(function ($q) use ($s) {
                    $q->whereRaw('LOWER(name) LIKE ?', [$s])
                      ->orWhereRaw('LOWER(sku) LIKE ?', [$s])
                      ->orWhereRaw('LOWER(barcode) LIKE ?', [$s]);
                });
            })
            ->when(isset($request->is_active), fn($q) => $q->where('is_active', $request->boolean('is_active')))
            // Same "out"/"in" stock definition as InventoryController::stockLevels for
            // products — summed across every warehouse's ingredient_stocks row.
            ->when($request->filter === 'out', fn($q) => $q->whereRaw(
                'COALESCE((SELECT SUM(quantity) FROM ingredient_stocks WHERE ingredient_id = ingredients.id), 0) <= 0'
            ))
            ->when($request->filter === 'in', fn($q) => $q->whereRaw(
                'COALESCE((SELECT SUM(quantity) FROM ingredient_stocks WHERE ingredient_id = ingredients.id), 0) > 0'
            ));

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

        // Opening stock goes where this user's till sells from — the sale takes a
        // made-to-order item's ingredients from its own branch's warehouse, so
        // stock parked in another branch's would read "available" and still be refused.
        $branchId = $this->effectiveBranchId($request) ?? $request->user()->branch_id;

        $ingredient = DB::transaction(function () use ($request, $data, $initialQty, $branchId) {
            $ingredient = Ingredient::create($data);

            $warehouse = $initialQty > 0 ? Warehouse::defaultForBranch($branchId) : null;
            if ($warehouse) {
                IngredientStock::create([
                    'ingredient_id' => $ingredient->id,
                    'warehouse_id'  => $warehouse->id,
                    'quantity'      => $initialQty,
                ]);
                // So the ingredient's Stock History starts with where its stock came from.
                IngredientStockAdjustment::create([
                    'ingredient_id'     => $ingredient->id,
                    'warehouse_id'      => $warehouse->id,
                    'user_id'           => $request->user()->id,
                    'type'              => 'in',
                    'reason'            => 'Opening stock',
                    'quantity_before'   => 0,
                    'quantity_adjusted' => $initialQty,
                    'quantity_after'    => $initialQty,
                ]);
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
        $productNames = Product::whereIn('id', ProductIngredient::where('ingredient_id', $ingredient->id)->pluck('product_id'))
            ->pluck('name');

        if ($productNames->isNotEmpty()) {
            return $this->error(
                'Cannot delete — this ingredient is used in the recipe for: ' . $productNames->implode(', '),
                422
            );
        }

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

    /** Tops up an ingredient's stock at a warehouse — the "running low" restock action. */
    public function addStock(Request $request, Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'warehouse_id' => 'required|exists:warehouses,id',
            'quantity'     => 'required|numeric|min:0.001',
            'reason'       => 'nullable|string',
        ]);

        DB::transaction(function () use ($request, $ingredient, $data) {
            $stock = IngredientStock::firstOrNew([
                'ingredient_id' => $ingredient->id,
                'warehouse_id'  => $data['warehouse_id'],
            ]);
            $stock->quantity ??= 0;
            $before = (float) $stock->quantity;
            $after  = $before + (float) $data['quantity'];
            $stock->quantity = $after;
            $stock->save();

            IngredientStockAdjustment::create([
                'ingredient_id'      => $ingredient->id,
                'warehouse_id'       => $data['warehouse_id'],
                'user_id'            => $request->user()->id,
                'type'               => 'in',
                'reason'             => $data['reason'] ?? 'Manual stock addition',
                'quantity_before'    => $before,
                'quantity_adjusted'  => (float) $data['quantity'],
                'quantity_after'     => $after,
            ]);
        });

        return $this->success(
            $ingredient->fresh()->load('unit')->loadSum('stocks', 'quantity'),
            'Ingredient stock added'
        );
    }

    /** Writes off ingredient stock at a warehouse — spoilage/wastage/damage, always with a reason. */
    public function subtractStock(Request $request, Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'warehouse_id' => 'required|exists:warehouses,id',
            'quantity'     => 'required|numeric|min:0.001',
            'reason'       => 'required|string',
        ]);

        DB::transaction(function () use ($request, $ingredient, $data) {
            $stock = IngredientStock::firstOrNew([
                'ingredient_id' => $ingredient->id,
                'warehouse_id'  => $data['warehouse_id'],
            ]);
            $stock->quantity ??= 0;
            $before = (float) $stock->quantity;

            if ((float) $data['quantity'] > $before) {
                abort(422, "Cannot remove {$data['quantity']} — only {$before} in stock at this warehouse.");
            }

            $after = $before - (float) $data['quantity'];
            $stock->quantity = $after;
            $stock->save();

            IngredientStockAdjustment::create([
                'ingredient_id'      => $ingredient->id,
                'warehouse_id'       => $data['warehouse_id'],
                'user_id'            => $request->user()->id,
                'type'               => 'damage',
                'reason'             => $data['reason'],
                'quantity_before'    => $before,
                'quantity_adjusted'  => -(float) $data['quantity'],
                'quantity_after'     => $after,
            ]);
        });

        return $this->success(
            $ingredient->fresh()->load('unit')->loadSum('stocks', 'quantity'),
            'Ingredient stock removed'
        );
    }

    /** Audit trail — every manual add/remove made against this ingredient's stock. */
    public function stockHistory(Ingredient $ingredient): \Illuminate\Http\JsonResponse
    {
        return $this->paginated(
            $ingredient->stockAdjustments()
                ->with(['warehouse:id,name', 'user:id,name'])
                ->latest()
                ->paginate(20)
        );
    }
}
