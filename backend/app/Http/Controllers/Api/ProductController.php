<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Stock;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class ProductController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);

        $query = Product::with('category', 'brand', 'unit', 'taxRate')
            ->withSum('stocks', 'quantity')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->when($request->search, function ($q) use ($request) {
                $s = '%' . mb_strtolower($request->search) . '%';
                $q->where(function ($q) use ($s) {
                    $q->whereRaw('LOWER(name) LIKE ?', [$s])
                      ->orWhereRaw('LOWER(sku) LIKE ?', [$s])
                      ->orWhereRaw('LOWER(barcode) LIKE ?', [$s]);
                });
            })
            ->when($request->category_id, fn($q) => $q->where('category_id', $request->category_id))
            ->when($request->brand_id, fn($q) => $q->where('brand_id', $request->brand_id))
            ->when(isset($request->is_active), fn($q) => $q->where('is_active', $request->boolean('is_active')))
            ->when($request->low_stock, fn($q) => $q->whereHas('stocks', function ($sq) {
                $sq->whereRaw('quantity <= products.reorder_level');
            }));

        if ($request->with_stock) {
            $query->with(['stocks.warehouse']);
        }

        return $this->paginated($query->orderBy('name')->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        // Every product belongs to exactly one branch's own catalog. Only an
        // admin may plant it in a branch other than their own.
        $user = $request->user();
        $branchId = ($user->hasRole('admin') && $request->filled('branch_id'))
            ? (int) $request->branch_id
            : $user->branch_id;

        $data = $request->validate([
            'name'            => 'required|string|max:255',
            'sku'             => ['nullable', 'string', Rule::unique('products')->where(fn($q) => $q->where('branch_id', $branchId))],
            'barcode'         => ['nullable', 'string', Rule::unique('products')->where(fn($q) => $q->where('branch_id', $branchId))],
            'category_id'     => 'nullable|exists:categories,id',
            'brand_id'        => 'nullable|exists:brands,id',
            'tax_rate_id'     => 'nullable|exists:tax_rates,id',
            'unit_id'         => 'nullable|exists:units,id',
            'description'     => 'nullable|string',
            'image'           => 'nullable|string|max:4000000',
            'cost_price'      => 'required|numeric|min:0',
            'selling_price'   => 'required|numeric|min:0',
            'wholesale_price' => 'nullable|numeric|min:0',
            'has_variants'    => 'boolean',
            'track_stock'     => 'boolean',
            'reorder_level'   => 'integer|min:0',
            'reorder_quantity' => 'integer|min:0',
            'expires'         => 'boolean',
            'alert_quantity'  => 'integer|min:0',
            'initial_quantity' => 'nullable|numeric|min:0',
        ]);

        $initialQty = (float) ($data['initial_quantity'] ?? 0);
        unset($data['initial_quantity']);

        $data['slug'] = Str::slug($data['name']) . '-' . uniqid();
        $data['branch_id'] = $branchId;

        $product = DB::transaction(function () use ($data, $initialQty, $branchId) {
            $product = Product::create($data);

            if ($initialQty > 0) {
                // Initial stock lands in the same branch the product now belongs to.
                $warehouse = \App\Models\Warehouse::where('branch_id', $branchId)->orderByDesc('is_default')->first()
                          ?? \App\Models\Warehouse::where('is_default', true)->first()
                          ?? \App\Models\Warehouse::first();
                if ($warehouse) {
                    Stock::updateOrCreate(
                        ['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'product_variant_id' => null, 'batch_number' => null],
                        ['quantity' => $initialQty]
                    );
                }
            }

            return $product;
        });

        return $this->success($product->load('category', 'brand', 'unit', 'taxRate')->loadSum('stocks', 'quantity'), 'Product created', 201);
    }

    /** True once a branch-locked user tries to touch another branch's product. Admins are exempt. */
    private function forbiddenCrossBranch(Request $request, Product $product): bool
    {
        $user = $request->user();
        return ! $user->hasRole('admin') && $product->branch_id !== $user->branch_id;
    }

    public function show(Request $request, Product $product): \Illuminate\Http\JsonResponse
    {
        if ($this->forbiddenCrossBranch($request, $product)) {
            return $this->error('Product not found.', 404);
        }

        return $this->success(
            $product->load('category', 'brand', 'unit', 'taxRate', 'variants', 'stocks.warehouse')
        );
    }

    public function update(Request $request, Product $product): \Illuminate\Http\JsonResponse
    {
        if ($this->forbiddenCrossBranch($request, $product)) {
            return $this->error('Product not found.', 404);
        }

        $data = $request->validate([
            'name'           => 'sometimes|string|max:255',
            'sku'            => ['nullable', 'string', Rule::unique('products')->where(fn($q) => $q->where('branch_id', $product->branch_id))->ignore($product->id)],
            'barcode'        => ['nullable', 'string', Rule::unique('products')->where(fn($q) => $q->where('branch_id', $product->branch_id))->ignore($product->id)],
            'category_id'    => 'nullable|exists:categories,id',
            'brand_id'       => 'nullable|exists:brands,id',
            'tax_rate_id'    => 'nullable|exists:tax_rates,id',
            'unit_id'        => 'nullable|exists:units,id',
            'description'    => 'nullable|string',
            'image'          => 'nullable|string|max:4000000',
            'cost_price'     => 'sometimes|numeric|min:0',
            'selling_price'  => 'sometimes|numeric|min:0',
            'wholesale_price'=> 'nullable|numeric|min:0',
            'has_variants'   => 'boolean',
            'track_stock'    => 'boolean',
            'is_active'      => 'boolean',
            'reorder_level'  => 'integer|min:0',
            'reorder_quantity'=> 'integer|min:0',
            'expires'        => 'boolean',
            'alert_quantity' => 'integer|min:0',
        ]);

        if (isset($data['name'])) {
            $data['slug'] = Str::slug($data['name']) . '-' . $product->id;
        }

        $product->update($data);

        return $this->success($product->load('category', 'brand', 'unit', 'taxRate'), 'Product updated');
    }

    public function destroy(Request $request, Product $product): \Illuminate\Http\JsonResponse
    {
        if ($this->forbiddenCrossBranch($request, $product)) {
            return $this->error('Product not found.', 404);
        }

        $product->delete();
        return $this->success(null, 'Product deleted');
    }

    public function search(Request $request): \Illuminate\Http\JsonResponse
    {
        $term = $request->q ?? '';
        $warehouseId = $request->warehouse_id;
        $branchId = $this->effectiveBranchId($request);

        $products = Product::with('category', 'taxRate', 'variants')
            ->where('is_active', true)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->where(function ($q) use ($term) {
                $q->where('name', 'like', "%{$term}%")
                  ->orWhere('barcode', $term)
                  ->orWhere('sku', 'like', "%{$term}%");
            })
            ->when($warehouseId, fn($q) => $q->whereHas('stocks', fn($s) => $s->where('warehouse_id', $warehouseId)->where('quantity', '>', 0)))
            ->limit(20)
            ->get()
            ->map(function ($product) use ($warehouseId) {
                $product->stock_quantity = $warehouseId
                    ? Stock::where('product_id', $product->id)->where('warehouse_id', $warehouseId)->sum('quantity')
                    : $product->stocks()->sum('quantity');
                return $product;
            });

        return $this->success($products);
    }
}
