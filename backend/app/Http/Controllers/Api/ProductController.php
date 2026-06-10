<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Stock;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ProductController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = Product::with('category', 'brand', 'unit', 'taxRate')
            ->withSum('stocks', 'quantity')
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
            }))
            ->when($request->branch_id, fn($q) => $q->whereHas('stocks.warehouse', fn($wq) => $wq->where('branch_id', $request->branch_id)));

        if ($request->with_stock) {
            $query->with(['stocks.warehouse']);
        }

        return $this->paginated($query->orderBy('name')->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'           => 'required|string|max:255',
            'sku'            => 'nullable|string|unique:products',
            'barcode'        => 'nullable|string|unique:products',
            'category_id'    => 'nullable|exists:categories,id',
            'brand_id'       => 'nullable|exists:brands,id',
            'tax_rate_id'    => 'nullable|exists:tax_rates,id',
            'unit_id'        => 'nullable|exists:units,id',
            'description'    => 'nullable|string',
            'cost_price'     => 'required|numeric|min:0',
            'selling_price'  => 'required|numeric|min:0',
            'wholesale_price'=> 'nullable|numeric|min:0',
            'has_variants'   => 'boolean',
            'track_stock'    => 'boolean',
            'reorder_level'  => 'integer|min:0',
            'reorder_quantity'=> 'integer|min:0',
            'expires'        => 'boolean',
            'alert_quantity' => 'integer|min:0',
        ]);

        $data['slug'] = Str::slug($data['name']) . '-' . uniqid();

        $product = Product::create($data);

        return $this->success($product->load('category', 'brand', 'unit', 'taxRate'), 'Product created', 201);
    }

    public function show(Product $product): \Illuminate\Http\JsonResponse
    {
        return $this->success(
            $product->load('category', 'brand', 'unit', 'taxRate', 'variants', 'stocks.warehouse')
        );
    }

    public function update(Request $request, Product $product): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'           => 'sometimes|string|max:255',
            'sku'            => "nullable|string|unique:products,sku,{$product->id}",
            'barcode'        => "nullable|string|unique:products,barcode,{$product->id}",
            'category_id'    => 'nullable|exists:categories,id',
            'brand_id'       => 'nullable|exists:brands,id',
            'tax_rate_id'    => 'nullable|exists:tax_rates,id',
            'unit_id'        => 'nullable|exists:units,id',
            'description'    => 'nullable|string',
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

    public function destroy(Product $product): \Illuminate\Http\JsonResponse
    {
        $product->delete();
        return $this->success(null, 'Product deleted');
    }

    public function search(Request $request): \Illuminate\Http\JsonResponse
    {
        $term = $request->q ?? '';
        $warehouseId = $request->warehouse_id;

        $products = Product::with('category', 'taxRate', 'variants')
            ->where('is_active', true)
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
