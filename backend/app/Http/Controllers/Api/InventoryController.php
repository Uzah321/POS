<?php

namespace App\Http\Controllers\Api;

use App\Models\Stock;
use App\Models\StockAdjustment;
use App\Models\StockAdjustmentItem;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\StockCount;
use App\Models\StockCountItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
}
