<?php
namespace App\Http\Controllers\Api;

use App\Models\Sale;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class KdsController extends Controller
{
    // Active orders for kitchen display — no auth required
    public function orders(): \Illuminate\Http\JsonResponse
    {
        $orders = Sale::with(['items.product'])
            ->whereNotNull('kds_status')
            ->whereIn('kds_status', ['new', 'preparing', 'ready'])
            ->where('status', 'completed')
            ->orderBy('completed_at', 'asc')
            ->get()
            ->map(function ($sale) {
                return [
                    'id'         => $sale->id,
                    'ticket'     => '#' . str_pad($sale->id % 1000, 3, '0', STR_PAD_LEFT),
                    'reference'  => $sale->reference,
                    'kds_status' => $sale->kds_status,
                    'items'      => $sale->items->map(fn($i) => [
                        'name' => $i->product->name ?? 'Item',
                        'qty'  => (int) $i->quantity,
                    ]),
                    'placed_at'  => $sale->completed_at
                        ? $sale->completed_at->toIso8601String()
                        : $sale->created_at->toIso8601String(),
                ];
            });

        return response()->json(['data' => $orders]);
    }

    // Kitchen staff update order status — no auth required
    public function updateStatus(Request $request, Sale $sale): \Illuminate\Http\JsonResponse
    {
        $request->validate(['status' => 'required|in:new,preparing,ready,served']);
        $sale->update(['kds_status' => $request->status]);
        return response()->json(['data' => ['id' => $sale->id, 'kds_status' => $sale->kds_status]]);
    }
}
