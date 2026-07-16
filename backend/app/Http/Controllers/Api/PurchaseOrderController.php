<?php

namespace App\Http\Controllers\Api;

use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptItem;
use App\Models\Stock;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PurchaseOrderController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = PurchaseOrder::with('supplier', 'branch', 'creator')->withCount('items')
            ->when($request->supplier_id, fn($q) => $q->where('supplier_id', $request->supplier_id))
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->status, fn($q) => $q->where('status', $request->status))
            ->when($request->date_from, fn($q) => $q->whereDate('order_date', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('order_date', '<=', $request->date_to));

        return $this->paginated($query->latest()->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'supplier_id'    => 'required|exists:suppliers,id',
            'branch_id'      => 'required|exists:branches,id',
            'warehouse_id'   => 'required|exists:warehouses,id',
            'order_date'     => 'required|date',
            'expected_date'  => 'nullable|date|after_or_equal:order_date',
            'notes'          => 'nullable|string',
            'items'          => 'required|array|min:1',
            'items.*.product_id'         => 'required|exists:products,id',
            'items.*.product_variant_id' => 'nullable|exists:product_variants,id',
            'items.*.quantity'           => 'required|numeric|min:0.001',
            'items.*.unit_cost'          => 'required|numeric|min:0',
        ]);

        // Each branch owns its own catalog — a PO can only order products that
        // actually belong to the branch it's being placed for.
        $productIds = collect($data['items'])->pluck('product_id')->unique();
        $ownedCount = \App\Models\Product::whereIn('id', $productIds)->where('branch_id', $data['branch_id'])->count();
        if ($ownedCount !== $productIds->count()) {
            return $this->error('One or more items do not belong to this branch.', 422);
        }

        return DB::transaction(function () use ($data, $request) {
            $subtotal = 0;
            foreach ($data['items'] as $item) {
                $subtotal += $item['quantity'] * $item['unit_cost'];
            }

            $po = PurchaseOrder::create([
                'supplier_id'   => $data['supplier_id'],
                'branch_id'     => $data['branch_id'],
                'warehouse_id'  => $data['warehouse_id'],
                'created_by'    => $request->user()->id,
                'order_date'    => $data['order_date'],
                'expected_date' => $data['expected_date'] ?? null,
                'status'        => 'draft',
                'subtotal'      => $subtotal,
                'total'         => $subtotal,
                'notes'         => $data['notes'] ?? null,
            ]);

            foreach ($data['items'] as $item) {
                PurchaseOrderItem::create([
                    'purchase_order_id'  => $po->id,
                    'product_id'         => $item['product_id'],
                    'product_variant_id' => $item['product_variant_id'] ?? null,
                    'quantity'           => $item['quantity'],
                    'unit_cost'          => $item['unit_cost'],
                    'subtotal'           => $item['quantity'] * $item['unit_cost'],
                ]);
            }

            return $this->success($po->load('items.product', 'supplier'), 'Purchase order created', 201);
        });
    }

    public function show(PurchaseOrder $purchaseOrder): \Illuminate\Http\JsonResponse
    {
        return $this->success($purchaseOrder->load('items.product', 'items.variant', 'supplier', 'branch', 'creator', 'approver', 'goodsReceipts.items', 'goodsReceipts.receiver'));
    }

    public function approve(Request $request, PurchaseOrder $purchaseOrder): \Illuminate\Http\JsonResponse
    {
        if ($purchaseOrder->status !== 'draft' && $purchaseOrder->status !== 'pending_approval') {
            return $this->error('This purchase order cannot be approved in its current state.');
        }

        $purchaseOrder->update([
            'status'      => 'approved',
            'approved_by' => $request->user()->id,
            'approved_at' => now(),
        ]);

        return $this->success($purchaseOrder, 'Purchase order approved');
    }

    public function receive(Request $request, PurchaseOrder $purchaseOrder): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'received_date'   => 'required|date',
            'notes'           => 'nullable|string',
            'invoice_number'  => 'nullable|string|max:255',
            'invoice_date'    => 'nullable|date',
            'invoice_amount'  => 'nullable|numeric|min:0',
            'items'         => 'required|array|min:1',
            'items.*.purchase_order_item_id' => 'required|exists:purchase_order_items,id',
            'items.*.product_id'             => 'required|exists:products,id',
            'items.*.product_variant_id'     => 'nullable|exists:product_variants,id',
            'items.*.quantity'               => 'required|numeric|min:0.001',
            'items.*.unit_cost'              => 'required|numeric|min:0',
            'items.*.batch_number'           => 'nullable|string',
            'items.*.expiry_date'            => 'nullable|date',
        ]);

        return DB::transaction(function () use ($data, $request, $purchaseOrder) {
            $gr = GoodsReceipt::create([
                'purchase_order_id' => $purchaseOrder->id,
                'warehouse_id'      => $purchaseOrder->warehouse_id,
                'received_by'       => $request->user()->id,
                'received_date'     => $data['received_date'],
                'notes'             => $data['notes'] ?? null,
                'invoice_number'    => $data['invoice_number'] ?? null,
                'invoice_date'      => $data['invoice_date'] ?? null,
                'invoice_amount'    => $data['invoice_amount'] ?? null,
            ]);

            foreach ($data['items'] as $item) {
                GoodsReceiptItem::create([
                    'goods_receipt_id'       => $gr->id,
                    'purchase_order_item_id' => $item['purchase_order_item_id'],
                    'product_id'             => $item['product_id'],
                    'product_variant_id'     => $item['product_variant_id'] ?? null,
                    'quantity'               => $item['quantity'],
                    'unit_cost'              => $item['unit_cost'],
                    'batch_number'           => $item['batch_number'] ?? null,
                    'expiry_date'            => $item['expiry_date'] ?? null,
                ]);

                // Update PO item received qty
                $poItem = PurchaseOrderItem::find($item['purchase_order_item_id']);
                $poItem->increment('received_quantity', $item['quantity']);

                // Add to stock
                $stock = Stock::firstOrNew([
                    'product_id'         => $item['product_id'],
                    'product_variant_id' => $item['product_variant_id'] ?? null,
                    'warehouse_id'       => $purchaseOrder->warehouse_id,
                    'batch_number'       => $item['batch_number'] ?? null,
                ]);
                $stock->quantity    = ($stock->quantity ?? 0) + $item['quantity'];
                $stock->expiry_date = $item['expiry_date'] ?? $stock->expiry_date;
                $stock->save();
            }

            // Update PO status
            $po = $purchaseOrder->fresh()->load('items');
            $allReceived = $po->items->every(fn($i) => $i->received_quantity >= $i->quantity);
            $purchaseOrder->update(['status' => $allReceived ? 'received' : 'partially_received']);

            return $this->success($gr->load('items'), 'Goods received successfully', 201);
        });
    }
}
