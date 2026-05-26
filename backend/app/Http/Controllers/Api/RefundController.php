<?php

namespace App\Http\Controllers\Api;

use App\Models\Refund;
use App\Models\RefundItem;
use App\Models\Sale;
use App\Models\Stock;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RefundController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = Refund::with('sale', 'user')
            ->when($request->sale_id, fn($q) => $q->where('sale_id', $request->sale_id))
            ->when($request->status, fn($q) => $q->where('status', $request->status));

        return $this->paginated($query->latest()->paginate(15));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'sale_id' => 'required|exists:sales,id',
            'reason'  => 'nullable|string',
            'items'   => 'required|array|min:1',
            'items.*.sale_item_id' => 'required|exists:sale_items,id',
            'items.*.quantity'     => 'required|numeric|min:0.001',
            'items.*.restock'      => 'boolean',
        ]);

        return DB::transaction(function () use ($data, $request) {
            $sale         = Sale::with('items')->findOrFail($data['sale_id']);
            $totalRefund  = 0;

            $refund = Refund::create([
                'sale_id' => $sale->id,
                'user_id' => $request->user()->id,
                'amount'  => 0,
                'reason'  => $data['reason'] ?? null,
                'status'  => 'completed',
                'completed_at' => now(),
            ]);

            foreach ($data['items'] as $item) {
                $saleItem = $sale->items->where('id', $item['sale_item_id'])->first();
                if (! $saleItem) continue;

                $refundQty = min($item['quantity'], $saleItem->quantity);
                $refundAmt = ($saleItem->total / $saleItem->quantity) * $refundQty;

                RefundItem::create([
                    'refund_id'    => $refund->id,
                    'sale_item_id' => $saleItem->id,
                    'quantity'     => $refundQty,
                    'amount'       => $refundAmt,
                    'restock'      => $item['restock'] ?? true,
                ]);

                $totalRefund += $refundAmt;

                // Restock if requested
                if ($item['restock'] ?? true) {
                    Stock::updateOrCreate(
                        ['product_id' => $saleItem->product_id, 'product_variant_id' => $saleItem->product_variant_id, 'warehouse_id' => $sale->warehouse_id],
                        ['quantity'   => DB::raw("quantity + {$refundQty}")]
                    );
                }
            }

            $refund->update(['amount' => $totalRefund]);

            // Update sale status
            $sale->update(['status' => 'refunded', 'amount_paid' => $sale->amount_paid - $totalRefund]);

            return $this->success($refund->load('items'), 'Refund processed', 201);
        });
    }

    public function show(Refund $refund): \Illuminate\Http\JsonResponse
    {
        return $this->success($refund->load('items.saleItem.product', 'sale', 'user'));
    }
}
