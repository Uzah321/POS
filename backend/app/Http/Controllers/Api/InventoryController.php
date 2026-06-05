<?php

namespace App\Http\Controllers\Api;

use App\Models\Stock;
use App\Models\Product;
use App\Models\Category;
use App\Models\Warehouse;
use App\Models\StockAdjustment;
use App\Models\StockAdjustmentItem;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\StockCount;
use App\Models\StockCountItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class InventoryController extends BaseApiController
{
    // Stock levels
    public function stockLevels(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = Stock::with('product.category', 'product.brand', 'variant', 'warehouse')
            ->when($request->warehouse_id, fn($q) => $q->where('warehouse_id', $request->warehouse_id))
            ->when($request->low_stock, fn($q) => $q->whereHas('product', fn($p) =>
                $p->whereRaw('stocks.quantity <= products.reorder_level')
            ))
            ->when($request->search, fn($q) => $q->whereHas('product', fn($p) =>
                $p->where('name', 'like', "%{$request->search}%")
                  ->orWhere('sku', 'like', "%{$request->search}%")
                  ->orWhere('barcode', $request->search)
            ));

        return $this->paginated($query->paginate($request->per_page ?? 20));
    }

    // Stock adjustment
    public function adjust(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'warehouse_id' => 'required|exists:warehouses,id',
            'type'         => 'required|in:in,out,damage,correction,opening,return',
            'reason'       => 'nullable|string',
            'items'        => 'required|array|min:1',
            'items.*.product_id'         => 'required|exists:products,id',
            'items.*.product_variant_id' => 'nullable|exists:product_variants,id',
            'items.*.quantity'           => 'required|numeric',
            'items.*.cost_price'         => 'nullable|numeric|min:0',
        ]);

        return DB::transaction(function () use ($data, $request) {
            $adj = StockAdjustment::create([
                'warehouse_id' => $data['warehouse_id'],
                'user_id'      => $request->user()->id,
                'type'         => $data['type'],
                'reason'       => $data['reason'] ?? null,
            ]);

            foreach ($data['items'] as $item) {
                $stock = Stock::firstOrNew([
                    'product_id'         => $item['product_id'],
                    'product_variant_id' => $item['product_variant_id'] ?? null,
                    'warehouse_id'       => $data['warehouse_id'],
                ]);
                $stock->quantity ??= 0;

                $before    = $stock->quantity;
                $quantity  = (float) $item['quantity'];
                $isNegative = in_array($data['type'], ['out', 'damage']);

                $after = $isNegative
                    ? max(0, $before - abs($quantity))
                    : $before + abs($quantity);

                $stock->quantity = $after;
                $stock->save();

                StockAdjustmentItem::create([
                    'stock_adjustment_id' => $adj->id,
                    'product_id'          => $item['product_id'],
                    'product_variant_id'  => $item['product_variant_id'] ?? null,
                    'quantity_before'     => $before,
                    'quantity_adjusted'   => $isNegative ? -abs($quantity) : abs($quantity),
                    'quantity_after'      => $after,
                    'cost_price'          => $item['cost_price'] ?? 0,
                ]);
            }

            return $this->success($adj->load('items.product'), 'Stock adjusted', 201);
        });
    }

    // Stock transfers
    public function transferIndex(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = StockTransfer::with('fromWarehouse', 'toWarehouse', 'creator')
            ->when($request->status, fn($q) => $q->where('status', $request->status));
        return $this->paginated($query->latest()->paginate(20));
    }

    public function createTransfer(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'from_warehouse_id' => 'required|exists:warehouses,id',
            'to_warehouse_id'   => 'required|exists:warehouses,id|different:from_warehouse_id',
            'transfer_date'     => 'required|date',
            'notes'             => 'nullable|string',
            'items'             => 'required|array|min:1',
            'items.*.product_id'         => 'required|exists:products,id',
            'items.*.product_variant_id' => 'nullable|exists:product_variants,id',
            'items.*.quantity'           => 'required|numeric|min:0.001',
        ]);

        return DB::transaction(function () use ($data, $request) {
            $transfer = StockTransfer::create([
                'from_warehouse_id' => $data['from_warehouse_id'],
                'to_warehouse_id'   => $data['to_warehouse_id'],
                'created_by'        => $request->user()->id,
                'status'            => 'draft',
                'transfer_date'     => $data['transfer_date'],
                'notes'             => $data['notes'] ?? null,
            ]);

            foreach ($data['items'] as $item) {
                StockTransferItem::create([
                    'stock_transfer_id'  => $transfer->id,
                    'product_id'         => $item['product_id'],
                    'product_variant_id' => $item['product_variant_id'] ?? null,
                    'quantity'           => $item['quantity'],
                ]);
            }

            return $this->success($transfer->load('items.product'), 'Transfer created', 201);
        });
    }

    public function receiveTransfer(Request $request, StockTransfer $stockTransfer): \Illuminate\Http\JsonResponse
    {
        if ($stockTransfer->status !== 'in_transit') {
            return $this->error('Transfer must be in transit to receive.');
        }

        return DB::transaction(function () use ($request, $stockTransfer) {
            foreach ($stockTransfer->items as $item) {
                // Deduct from source
                $from = Stock::where('warehouse_id', $stockTransfer->from_warehouse_id)
                    ->where('product_id', $item->product_id)
                    ->where('product_variant_id', $item->product_variant_id)
                    ->first();
                if ($from) $from->decrement('quantity', $item->quantity);

                // Add to destination
                $to = Stock::firstOrNew([
                    'product_id'         => $item->product_id,
                    'product_variant_id' => $item->product_variant_id,
                    'warehouse_id'       => $stockTransfer->to_warehouse_id,
                ]);
                $to->quantity = ($to->quantity ?? 0) + $item->quantity;
                $to->save();

                $item->update(['received_quantity' => $item->quantity]);
            }

            $stockTransfer->update(['status' => 'received', 'received_at' => now()]);

            return $this->success($stockTransfer->load('items'), 'Transfer received');
        });
    }

    /**
     * POST /api/inventory/import
     * Accepts a JSON array of rows parsed from Excel on the frontend.
     * Each row: { name, sku?, barcode?, category?, cost_price?, selling_price?, quantity?, warehouse? }
     * Creates or updates products and sets stock quantities.
     */
    public function importStock(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate([
            'rows'              => 'required|array|min:1|max:2000',
            'rows.*.name'       => 'required|string|max:255',
            'rows.*.quantity'   => 'nullable|numeric|min:0',
            'rows.*.cost_price' => 'nullable|numeric|min:0',
            'rows.*.selling_price' => 'nullable|numeric|min:0',
            'warehouse_id'      => 'required|exists:warehouses,id',
            'branch_id'         => 'nullable|exists:branches,id',
        ]);

        $warehouseId = $request->warehouse_id;
        $created = 0; $updated = 0; $skipped = 0;
        $errors  = [];

        DB::transaction(function () use ($request, $warehouseId, &$created, &$updated, &$skipped, &$errors) {
            foreach ($request->rows as $index => $row) {
                try {
                    $name = trim($row['name'] ?? '');
                    if (!$name) { $skipped++; continue; }

                    // Resolve or create category
                    $categoryId = null;
                    if (!empty($row['category'])) {
                        $cat = Category::firstOrCreate(
                            ['name' => trim($row['category'])],
                            ['slug' => Str::slug(trim($row['category']))]
                        );
                        $categoryId = $cat->id;
                    }

                    // Resolve product by SKU, barcode, or name
                    $product = null;
                    if (!empty($row['sku'])) {
                        $product = Product::where('sku', trim($row['sku']))->first();
                    }
                    if (!$product && !empty($row['barcode'])) {
                        $product = Product::where('barcode', trim($row['barcode']))->first();
                    }
                    if (!$product) {
                        $product = Product::where('name', $name)->first();
                    }

                    $attrs = [
                        'name'          => $name,
                        'slug'          => Str::slug($name) . '-' . Str::random(4),
                        'category_id'   => $categoryId,
                        'cost_price'    => !empty($row['cost_price'])    ? floatval($row['cost_price'])    : 0,
                        'selling_price' => !empty($row['selling_price']) ? floatval($row['selling_price']) : 0,
                        'reorder_level' => !empty($row['reorder_level']) ? intval($row['reorder_level'])   : 5,
                        'is_active'     => true,
                    ];
                    if (!empty($row['sku']))     $attrs['sku']     = trim($row['sku']);
                    if (!empty($row['barcode'])) $attrs['barcode'] = trim($row['barcode']);
                    if (!empty($row['unit']))    $attrs['unit']    = trim($row['unit']);

                    if ($product) {
                        // Update existing — only non-empty values overwrite
                        $updateable = array_filter($attrs, fn($v) => $v !== null && $v !== '' && $v !== 0);
                        unset($updateable['slug']); // keep existing slug
                        $product->update($updateable);
                        $updated++;
                    } else {
                        $product = Product::create($attrs);
                        $created++;
                    }

                    // Set stock quantity
                    if (isset($row['quantity']) && $row['quantity'] !== '') {
                        $qty = max(0, floatval($row['quantity']));
                        Stock::updateOrCreate(
                            ['product_id' => $product->id, 'warehouse_id' => $warehouseId],
                            ['quantity' => $qty, 'branch_id' => $request->branch_id ?? null]
                        );
                    }
                } catch (\Throwable $e) {
                    $errors[] = "Row " . ($index + 1) . " ({$row['name']}): " . $e->getMessage();
                }
            }
        });

        return $this->success([
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
            'errors'  => $errors,
        ], "Import complete: {$created} created, {$updated} updated, {$skipped} skipped.");
    }

    /**
     * GET /api/inventory/import-template
     * Returns a CSV template the user can fill in for import.
     */
    public function importTemplate(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="stock-import-template.csv"',
        ];
        return response()->stream(function () {
            $f = fopen('php://output', 'w');
            fputcsv($f, ['name', 'sku', 'barcode', 'category', 'cost_price', 'selling_price', 'quantity', 'reorder_level', 'unit']);
            fputcsv($f, ['Pampers Size 3', 'PAM-S3', '6001101234567', 'Diapers', '12.50', '18.00', '100', '10', 'Pack']);
            fputcsv($f, ['Huggies Newborn', 'HUG-NB', '', 'Diapers', '10.00', '15.00', '50', '5', 'Pack']);
            fclose($f);
        }, 200, $headers);
    }
}
