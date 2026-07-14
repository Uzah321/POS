<?php

namespace App\Http\Controllers\Api;

use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\Stock;
use App\Models\Product;
use App\Models\Warehouse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class StockTransferController extends BaseApiController
{
    private const EAGER = ['fromWarehouse.branch', 'toWarehouse.branch', 'creator', 'items.product', 'items.receivedProduct'];

    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = StockTransfer::with(self::EAGER)
            ->when($request->status, fn($q) => $q->where('status', $request->status));

        return $this->paginated($query->latest()->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'from_branch_id' => 'required|exists:branches,id|different:to_branch_id',
            'to_branch_id'   => 'required|exists:branches,id',
            'notes'          => 'nullable|string',
            'items'          => 'required|array|min:1',
            'items.*.product_id'         => 'required|exists:products,id',
            'items.*.product_variant_id' => 'nullable|exists:product_variants,id',
            'items.*.quantity'           => 'required|numeric|min:0.001',
        ]);

        $fromWarehouse = Warehouse::where('branch_id', $data['from_branch_id'])->orderByDesc('is_default')->first();
        $toWarehouse   = Warehouse::where('branch_id', $data['to_branch_id'])->orderByDesc('is_default')->first();

        if (! $fromWarehouse) return $this->error('The source branch has no warehouse configured.', 422);
        if (! $toWarehouse)   return $this->error('The destination branch has no warehouse configured.', 422);

        // Each branch owns its own catalog now — you can only dispatch a product
        // that actually belongs to (and is stocked at) the source branch.
        $productIds = collect($data['items'])->pluck('product_id')->unique();
        $ownedCount = Product::whereIn('id', $productIds)->where('branch_id', $data['from_branch_id'])->count();
        if ($ownedCount !== $productIds->count()) {
            return $this->error('One or more items do not belong to the source branch.', 422);
        }

        return DB::transaction(function () use ($data, $request, $fromWarehouse, $toWarehouse) {
            $transfer = StockTransfer::create([
                'from_warehouse_id' => $fromWarehouse->id,
                'to_warehouse_id'   => $toWarehouse->id,
                'created_by'        => $request->user()->id,
                'status'            => 'pending',
                'transfer_date'     => now()->toDateString(),
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

            return $this->success($transfer->load(self::EAGER), 'Transfer created', 201);
        });
    }

    public function show(StockTransfer $stockTransfer): \Illuminate\Http\JsonResponse
    {
        return $this->success($stockTransfer->load(self::EAGER));
    }

    public function dispatch(Request $request, StockTransfer $stockTransfer): \Illuminate\Http\JsonResponse
    {
        if ($stockTransfer->status !== 'pending') {
            return $this->error('Only a pending transfer can be dispatched.', 422);
        }

        return DB::transaction(function () use ($stockTransfer) {
            foreach ($stockTransfer->items as $item) {
                $stock = Stock::where('warehouse_id', $stockTransfer->from_warehouse_id)
                    ->where('product_id', $item->product_id)
                    ->where('product_variant_id', $item->product_variant_id)
                    ->first();

                if (! $stock || $stock->quantity < $item->quantity) {
                    return $this->error("Insufficient stock for {$item->product->name} at the source warehouse.", 422);
                }
            }

            foreach ($stockTransfer->items as $item) {
                Stock::where('warehouse_id', $stockTransfer->from_warehouse_id)
                    ->where('product_id', $item->product_id)
                    ->where('product_variant_id', $item->product_variant_id)
                    ->first()
                    ->decrement('quantity', $item->quantity);
            }

            $stockTransfer->update(['status' => 'in_transit']);

            return $this->success($stockTransfer->load(self::EAGER), 'Transfer dispatched');
        });
    }

    public function receive(Request $request, StockTransfer $stockTransfer): \Illuminate\Http\JsonResponse
    {
        if ($stockTransfer->status !== 'in_transit') {
            return $this->error('Transfer must be in transit to receive.', 422);
        }

        return DB::transaction(function () use ($stockTransfer) {
            $toBranchId = $stockTransfer->toWarehouse->branch_id;

            foreach ($stockTransfer->items as $item) {
                $resolvedProductId = $this->resolveDestinationProduct($item->product, $toBranchId);

                $stock = Stock::firstOrCreate(
                    [
                        'product_id'         => $resolvedProductId,
                        'product_variant_id' => $item->product_variant_id,
                        'warehouse_id'       => $stockTransfer->to_warehouse_id,
                    ],
                    ['quantity' => 0]
                );
                $stock->increment('quantity', $item->quantity);
                $item->update(['received_quantity' => $item->quantity, 'received_product_id' => $resolvedProductId]);
            }

            $stockTransfer->update(['status' => 'received', 'received_at' => now()]);

            return $this->success($stockTransfer->load(self::EAGER), 'Transfer received');
        });
    }

    /**
     * Each branch owns its own product catalog, so the source branch's product
     * row usually isn't the row the destination branch stocks against. Find the
     * destination branch's matching product (by SKU, then barcode), or — if this
     * is the first time this item has ever moved to that branch — clone it into
     * a new row there so the branch has its own editable catalog entry going
     * forward. Variant-level items keep their source variant id as-is (cloning
     * variant trees across branches is not handled here).
     */
    private function resolveDestinationProduct(?Product $sourceProduct, int $toBranchId): ?int
    {
        if (! $sourceProduct) {
            return null;
        }
        if ($sourceProduct->branch_id === $toBranchId) {
            return $sourceProduct->id;
        }

        if (! $sourceProduct->sku && ! $sourceProduct->barcode) {
            $match = null; // nothing reliable to match on — always clone a fresh row
        } else {
            $match = Product::where('branch_id', $toBranchId)
                ->where(function ($q) use ($sourceProduct) {
                    if ($sourceProduct->sku) {
                        $q->orWhere('sku', $sourceProduct->sku);
                    }
                    if ($sourceProduct->barcode) {
                        $q->orWhere('barcode', $sourceProduct->barcode);
                    }
                })
                ->first();
        }

        if ($match) {
            return $match->id;
        }

        $clone = Product::create([
            'branch_id'        => $toBranchId,
            'name'             => $sourceProduct->name,
            'slug'             => Str::slug($sourceProduct->name) . '-' . uniqid(),
            'sku'              => $sourceProduct->sku,
            'barcode'          => $sourceProduct->barcode,
            'category_id'      => $sourceProduct->category_id,
            'brand_id'         => $sourceProduct->brand_id,
            'tax_rate_id'      => $sourceProduct->tax_rate_id,
            'unit_id'          => $sourceProduct->unit_id,
            'description'      => $sourceProduct->description,
            'cost_price'       => $sourceProduct->cost_price,
            'selling_price'    => $sourceProduct->selling_price,
            'wholesale_price'  => $sourceProduct->wholesale_price,
            'track_stock'      => $sourceProduct->track_stock,
            'reorder_level'    => $sourceProduct->reorder_level,
            'reorder_quantity' => $sourceProduct->reorder_quantity,
            'expires'          => $sourceProduct->expires,
            'alert_quantity'   => $sourceProduct->alert_quantity,
        ]);

        return $clone->id;
    }

    public function cancel(Request $request, StockTransfer $stockTransfer): \Illuminate\Http\JsonResponse
    {
        if (! in_array($stockTransfer->status, ['pending', 'in_transit'])) {
            return $this->error('Only a pending or in-transit transfer can be cancelled.', 422);
        }

        return DB::transaction(function () use ($stockTransfer) {
            // Stock already left the source warehouse once dispatched — put it back.
            if ($stockTransfer->status === 'in_transit') {
                foreach ($stockTransfer->items as $item) {
                    $stock = Stock::firstOrCreate(
                        [
                            'product_id'         => $item->product_id,
                            'product_variant_id' => $item->product_variant_id,
                            'warehouse_id'       => $stockTransfer->from_warehouse_id,
                        ],
                        ['quantity' => 0]
                    );
                    $stock->increment('quantity', $item->quantity);
                }
            }

            $stockTransfer->update(['status' => 'cancelled']);

            return $this->success($stockTransfer->load(self::EAGER), 'Transfer cancelled');
        });
    }
}
