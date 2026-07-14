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
        $orders = Sale::with(['items.product', 'items.variant', 'customer'])
            ->whereNotNull('kds_status')
            ->whereIn('kds_status', ['new', 'preparing', 'ready'])
            ->where('status', 'completed')
            ->orderBy('completed_at', 'asc')
            ->get()
            ->map(function ($sale) {
                return [
                    'id'           => $sale->id,
                    'ticket'       => '#' . str_pad($sale->id % 1000, 3, '0', STR_PAD_LEFT),
                    'reference'    => $sale->reference,
                    'kds_status'   => $sale->kds_status,
                    'table_number' => $sale->table_number,
                    'order_type'   => $sale->order_type,
                    'customer'     => $sale->customer->name ?? null,
                    'notes'        => $sale->notes,
                    'items'        => $sale->items->map(fn($i) => [
                        'name'        => $i->product->name ?? 'Item',
                        'variant'     => $i->variant->name ?? null,
                        'description' => $i->product->description ?? null,
                        'note'        => $i->note,
                        'qty'         => (int) $i->quantity,
                    ]),
                    'placed_at'    => $sale->completed_at
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

    /**
     * Server's LAN IP + port — lets Kitchen/Queue Display screens tell staff what
     * URL to open on a separate device (tablet, second monitor) on the network.
     * No auth required — this is display-only, no sensitive data.
     */
    public function networkInfo(Request $request): \Illuminate\Http\JsonResponse
    {
        $host = gethostname() ?: 'localhost';
        $ip   = gethostbyname($host);
        if ($ip === $host) { // resolution failed — gethostbyname() echoes the input back
            $ip = null;
        }

        return response()->json([
            'data' => [
                'hostname' => $host,
                'ip'       => $ip,
                'port'     => (int) ($request->server('SERVER_PORT') ?: 8080),
            ],
        ]);
    }
}
