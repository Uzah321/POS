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
        $query = Refund::with('sale', 'user', 'items')
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
            $sale = Sale::with('items')->findOrFail($data['sale_id']);

            // A voided sale already had its stock restored by SaleController::cancel() —
            // refunding it too would restore the same units a second time.
            if ($sale->status === 'voided') {
                abort(422, 'This sale has been voided and cannot be refunded.');
            }

            $totalRefund  = 0;
            $refundedAny  = false;

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

                // Cap at what's actually still refundable — previous refunds on this
                // line item count against the original quantity, so the same units
                // can't be refunded twice.
                $alreadyRefunded = RefundItem::where('sale_item_id', $saleItem->id)->sum('quantity');
                $refundable = max(0, $saleItem->quantity - $alreadyRefunded);
                $refundQty = min($item['quantity'], $refundable);
                if ($refundQty <= 0) continue;

                $refundAmt = ($saleItem->total / $saleItem->quantity) * $refundQty;

                RefundItem::create([
                    'refund_id'    => $refund->id,
                    'sale_item_id' => $saleItem->id,
                    'quantity'     => $refundQty,
                    'amount'       => $refundAmt,
                    'restock'      => $item['restock'] ?? true,
                ]);

                $totalRefund += $refundAmt;
                $refundedAny = true;

                // Restock if requested
                if ($item['restock'] ?? true) {
                    $stock = Stock::firstOrCreate(
                        ['product_id' => $saleItem->product_id, 'product_variant_id' => $saleItem->product_variant_id, 'warehouse_id' => $sale->warehouse_id],
                        ['quantity' => 0]
                    );
                    $stock->increment('quantity', $refundQty);
                }
            }

            if (! $refundedAny) {
                abort(422, 'Nothing left to refund on the selected line items.');
            }

            $refund->update(['amount' => $totalRefund]);

            // Full vs partial refund — compare total refunded (including this one)
            // against each line item's original quantity across the whole sale.
            $fullyRefunded = $sale->items->every(function ($saleItem) {
                $refunded = RefundItem::where('sale_item_id', $saleItem->id)->sum('quantity');
                return $refunded >= $saleItem->quantity;
            });

            $sale->update([
                'status' => $fullyRefunded ? 'refunded' : 'partially_refunded',
                'amount_paid' => $sale->amount_paid - $totalRefund,
            ]);

            return $this->success($refund->load('items'), 'Refund processed', 201);
        });
    }

    public function show(Refund $refund): \Illuminate\Http\JsonResponse
    {
        return $this->success($refund->load('items.saleItem.product', 'sale', 'user'));
    }
}
