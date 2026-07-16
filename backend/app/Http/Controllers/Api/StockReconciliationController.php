<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Stock;
use App\Models\Stocktake;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StockReconciliationController extends BaseApiController
{
    public function reconcile(Request $request)
    {
        $branchId    = $request->branch_id;
        $warehouseId = $request->warehouse_id;

        // Default to current ISO week (Monday to today)
        $dateFrom = $request->date_from ?? now()->startOfWeek()->toDateString();
        $dateTo   = $request->date_to   ?? now()->toDateString();

        // Units sold in period
        $soldMap = DB::table('sale_items')
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.status', 'completed')
            ->when($branchId, fn($q) => $q->where('sales.branch_id', $branchId))
            ->when($warehouseId, fn($q) => $q->where('sales.warehouse_id', $warehouseId))
            ->whereBetween(DB::raw('DATE(sales.completed_at)'), [$dateFrom, $dateTo])
            ->groupBy('sale_items.product_id')
            ->selectRaw('sale_items.product_id, SUM(sale_items.quantity) as sold_qty, SUM(sale_items.total) as sold_value')
            ->get()->keyBy('product_id');

        // Purchases received in period
        $receivedMap = DB::table('goods_receipt_items')
            ->join('goods_receipts', 'goods_receipts.id', '=', 'goods_receipt_items.goods_receipt_id')
            ->when($warehouseId, fn($q) => $q->where('goods_receipts.warehouse_id', $warehouseId))
            ->whereBetween('goods_receipts.received_date', [$dateFrom, $dateTo])
            ->groupBy('goods_receipt_items.product_id')
            ->selectRaw('goods_receipt_items.product_id, SUM(goods_receipt_items.quantity) as received_qty')
            ->get()->keyBy('product_id');

        // Current system stock — stocks has no branch_id column, only warehouse_id,
        // so a branch filter has to go through the branch's warehouses. Grouped/summed
        // by product since a product can have more than one stock row (multiple
        // warehouses or batches) — keying raw rows by product_id would silently drop
        // all but the last row instead of totaling them.
        $stockMap = Stock::when($warehouseId, fn($q) => $q->where('warehouse_id', $warehouseId))
            ->when($branchId, fn($q) => $q->whereIn('warehouse_id', \App\Models\Warehouse::where('branch_id', $branchId)->pluck('id')))
            ->groupBy('product_id')
            ->selectRaw('product_id, SUM(quantity) as quantity')
            ->get()->keyBy('product_id');

        // Last completed stocktake BEFORE period (for opening stock reference)
        $openingStocktake = Stocktake::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->where('created_at', '<', $dateFrom . ' 00:00:00')
            ->latest()->with('items')->first();

        $openingItems = [];
        if ($openingStocktake) {
            foreach ($openingStocktake->items as $item) {
                $openingItems[$item->product_id] = (float) $item->counted_qty;
            }
        }

        // Latest completed stocktake WITHIN period (for actual count)
        $periodStocktake = Stocktake::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween(DB::raw('DATE(created_at)'), [$dateFrom, $dateTo])
            ->latest()->with('items')->first();

        $periodItems = [];
        if ($periodStocktake) {
            foreach ($periodStocktake->items as $item) {
                $periodItems[$item->product_id] = (float) $item->counted_qty;
            }
        }

        // Last completed stocktake anywhere (for warning)
        $lastStocktake = Stocktake::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->latest()->first();

        $daysSinceLast = $lastStocktake ? now()->diffInDays($lastStocktake->created_at) : null;

        // Build reconciliation rows
        $products = Product::with('category:id,name')->where('is_active', true)->get();
        $rows     = [];

        foreach ($products as $product) {
            $pid      = $product->id;
            $sold     = (float) ($soldMap[$pid]->sold_qty ?? 0);
            $received = (float) ($receivedMap[$pid]->received_qty ?? 0);
            $current  = (float) ($stockMap[$pid]->quantity ?? 0);

            // Opening stock: use last stocktake count before period, else back-calculate
            $opening = isset($openingItems[$pid])
                ? $openingItems[$pid]
                : $current - $received + $sold;

            $expected = $opening + $received - $sold;

            // Actual: use period stocktake if available, otherwise current system stock
            $actual   = isset($periodItems[$pid]) ? $periodItems[$pid] : $current;
            $variance = $actual - $expected;

            // Skip products with no activity and no stock
            if ($opening == 0 && $sold == 0 && $received == 0 && $actual == 0) {
                continue;
            }

            $rows[] = [
                'product_id'     => $pid,
                'product_name'   => $product->name,
                'sku'            => $product->sku ?? '—',
                'category'       => $product->category?->name ?? '—',
                'cost_price'     => (float) $product->cost_price,
                'selling_price'  => (float) $product->selling_price,
                'opening_stock'  => $opening,
                'purchases'      => $received,
                'sales'          => $sold,
                'sold_value'     => (float) ($soldMap[$pid]->sold_value ?? 0),
                'expected_stock' => $expected,
                'actual_stock'   => $actual,
                'variance'       => $variance,
                'variance_value' => round(abs($variance) * $product->cost_price, 2),
                'status'         => $variance == 0 ? 'ok' : ($variance < 0 ? 'short' : 'over'),
                'has_stocktake'  => isset($periodItems[$pid]),
            ];
        }

        if ($request->export === 'csv') {
            return $this->exportCsv($rows, $dateFrom, $dateTo);
        }

        $varRows = array_filter($rows, fn($r) => $r['status'] !== 'ok');
        $summary = [
            'total_products'           => count($rows),
            'products_ok'              => count(array_filter($rows, fn($r) => $r['status'] === 'ok')),
            'products_short'           => count(array_filter($rows, fn($r) => $r['status'] === 'short')),
            'products_over'            => count(array_filter($rows, fn($r) => $r['status'] === 'over')),
            'total_variance_value'     => array_sum(array_column(array_values($varRows), 'variance_value')),
            'days_since_last_stocktake'=> $daysSinceLast,
            'last_stocktake_date'      => $lastStocktake?->created_at?->toDateString(),
            'stocktake_warning'        => is_null($daysSinceLast) || $daysSinceLast >= 7,
            'has_period_stocktake'     => !is_null($periodStocktake),
            'period_stocktake_ref'     => $periodStocktake?->reference,
        ];

        return $this->success([
            'from'     => $dateFrom,
            'to'       => $dateTo,
            'summary'  => $summary,
            'products' => array_values($rows),
        ]);
    }

    private function exportCsv(array $rows, string $from, string $to)
    {
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"stock-reconciliation-{$from}-to-{$to}.csv\"",
            'Cache-Control'       => 'no-cache',
        ];

        $callback = function () use ($rows, $from, $to) {
            $f = fopen('php://output', 'w');
            fputcsv($f, ["STOCK RECONCILIATION - {$from} to {$to}"]);
            fputcsv($f, []);
            fputcsv($f, [
                'Product', 'SKU', 'Category', 'Cost Price',
                'Opening Stock', '+ Purchases', '- Sales', '= Expected Closing',
                'Actual Stock', 'Variance', 'Variance Value ($)', 'Status',
            ]);
            foreach ($rows as $r) {
                fputcsv($f, [
                    $r['product_name'], $r['sku'], $r['category'], $r['cost_price'],
                    $r['opening_stock'], $r['purchases'], $r['sales'], $r['expected_stock'],
                    $r['actual_stock'], $r['variance'], $r['variance_value'],
                    strtoupper($r['status']),
                ]);
            }
            // Summary
            $short = array_sum(array_column(array_filter($rows, fn($r) => $r['status'] === 'short'), 'variance_value'));
            $over  = array_sum(array_column(array_filter($rows, fn($r) => $r['status'] === 'over'), 'variance_value'));
            fputcsv($f, []);
            fputcsv($f, ['SHORT variance value:', $short]);
            fputcsv($f, ['OVER variance value:', $over]);
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }
}
