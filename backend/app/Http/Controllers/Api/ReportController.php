<?php

namespace App\Http\Controllers\Api;

use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Expense;
use App\Models\Product;
use App\Models\Stock;
use App\Models\Customer;
use App\Models\ShiftEnd;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ReportController extends BaseApiController
{
    public function dashboard(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $request->branch_id;
        $cacheKey = 'dashboard:' . ($branchId ?: 'all');

        $payload = Cache::remember($cacheKey, now()->addSeconds(30), function () use ($branchId) {
            $today = now()->toDateString();
            $thisMonth = now()->startOfMonth()->toDateString();

            $todaySales = Sale::where('status', 'completed')
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->whereDate('completed_at', $today)
                ->get(['total']);

            $monthSales = Sale::where('status', 'completed')
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->whereDate('completed_at', '>=', $thisMonth)
                ->get(['total']);

            $lowStockCount = Stock::query()
                ->join('products', 'products.id', '=', 'stocks.product_id')
                ->where('products.is_active', true)
                ->whereColumn('stocks.quantity', '<=', 'products.reorder_level')
                ->count();

            // Sales by day (last 30 days)
            $salesTrend = Sale::where('status', 'completed')
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->where('completed_at', '>=', now()->subDays(30))
                ->groupBy(DB::raw('DATE(completed_at)'))
                ->selectRaw('DATE(completed_at) as date, SUM(total) as revenue, COUNT(*) as transactions')
                ->orderBy('date')
                ->get();

            // Top products (last 30 days)
            $topProducts = SaleItem::whereHas('sale', fn($q) =>
                    $q->where('status', 'completed')
                      ->when($branchId, fn($sq) => $sq->where('branch_id', $branchId))
                      ->where('completed_at', '>=', now()->subDays(30))
                )
                ->groupBy('product_id')
                ->selectRaw('product_id, SUM(quantity) as total_qty, SUM(total) as total_revenue')
                ->with('product:id,name,image,sku')
                ->orderByDesc('total_revenue')
                ->limit(5)
                ->get();

            // Payment method breakdown today
            $paymentBreakdown = DB::table('sale_payments')
                ->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
                ->where('sales.status', 'completed')
                ->when($branchId, fn($q) => $q->where('sales.branch_id', $branchId))
                ->whereDate('sales.completed_at', $today)
                ->groupBy('sale_payments.method')
                ->selectRaw('sale_payments.method, SUM(sale_payments.amount) as total')
                ->get();

            return [
                'today' => [
                    'revenue' => $todaySales->sum('total'),
                    'transactions' => $todaySales->count(),
                    'avg_sale' => $todaySales->count() > 0 ? $todaySales->sum('total') / $todaySales->count() : 0,
                ],
                'month' => [
                    'revenue' => $monthSales->sum('total'),
                    'transactions' => $monthSales->count(),
                ],
                'low_stock_count' => $lowStockCount,
                'total_customers' => Customer::count(),
                'sales_trend' => $salesTrend,
                'top_products' => $topProducts,
                'payment_breakdown' => $paymentBreakdown,
            ];
        });

        return $this->success($payload);
    }

    public function salesReport(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to'   => 'required|date|after_or_equal:date_from',
        ]);

        $query = Sale::with('cashier:id,name', 'branch:id,name', 'customer:id,name')
            ->where('status', 'completed')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->cashier_id, fn($q) => $q->where('user_id', $request->cashier_id))
            ->whereDate('completed_at', '>=', $request->date_from)
            ->whereDate('completed_at', '<=', $request->date_to);

        $sales    = $query->latest('completed_at')->paginate($request->per_page ?? 50);
        $summary  = [
            'total_revenue'     => $query->sum('total'),
            'total_transactions'=> $query->count(),
            'total_discount'    => $query->sum('discount_amount'),
            'total_tax'         => $query->sum('tax_amount'),
            'total_refunds'     => DB::table('refunds')->where('status', 'completed')
                ->when($request->date_from, fn($q) => $q->whereDate('created_at', '>=', $request->date_from))
                ->when($request->date_to, fn($q) => $q->whereDate('created_at', '<=', $request->date_to))
                ->sum('amount'),
        ];

        return $this->success(compact('sales', 'summary'));
    }

    public function inventoryReport(Request $request): \Illuminate\Http\JsonResponse
    {
        $products = Product::with('category', 'brand', 'stocks.warehouse')
            ->where('is_active', true)
            ->when($request->category_id, fn($q) => $q->where('category_id', $request->category_id))
            ->when($request->warehouse_id, fn($q) => $q->whereHas('stocks', fn($s) => $s->where('warehouse_id', $request->warehouse_id)))
            ->get()
            ->map(function ($product) use ($request) {
                $stockQty = $request->warehouse_id
                    ? $product->stocks->where('warehouse_id', $request->warehouse_id)->sum('quantity')
                    : $product->stocks->sum('quantity');

                return [
                    'id'            => $product->id,
                    'name'          => $product->name,
                    'sku'           => $product->sku,
                    'category'      => $product->category?->name,
                    'cost_price'    => $product->cost_price,
                    'selling_price' => $product->selling_price,
                    'stock_qty'     => $stockQty,
                    'stock_value'   => $stockQty * $product->cost_price,
                    'reorder_level' => $product->reorder_level,
                    'is_low_stock'  => $stockQty <= $product->reorder_level,
                ];
            });

        $summary = [
            'total_products'   => $products->count(),
            'total_stock_value'=> $products->sum('stock_value'),
            'low_stock_count'  => $products->where('is_low_stock', true)->count(),
            'out_of_stock'     => $products->where('stock_qty', '<=', 0)->count(),
        ];

        return $this->success(compact('products', 'summary'));
    }

    public function profitLoss(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to'   => 'required|date',
        ]);

        $revenue = Sale::where('status', 'completed')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->whereDate('completed_at', '>=', $request->date_from)
            ->whereDate('completed_at', '<=', $request->date_to)
            ->sum('total');

        $cogs = SaleItem::whereHas('sale', fn($q) =>
                $q->where('status', 'completed')
                  ->when($request->branch_id, fn($sq) => $sq->where('branch_id', $request->branch_id))
                  ->whereDate('completed_at', '>=', $request->date_from)
                  ->whereDate('completed_at', '<=', $request->date_to)
            )
            ->selectRaw('SUM(cost_price * quantity) as total')
            ->value('total') ?? 0;

        $expenses = Expense::where('status', 'approved')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->whereDate('expense_date', '>=', $request->date_from)
            ->whereDate('expense_date', '<=', $request->date_to)
            ->sum('amount');

        $grossProfit = $revenue - $cogs;
        $netProfit   = $grossProfit - $expenses;

        return $this->success([
            'revenue'       => $revenue,
            'cogs'          => $cogs,
            'gross_profit'  => $grossProfit,
            'gross_margin'  => $revenue > 0 ? round(($grossProfit / $revenue) * 100, 2) : 0,
            'expenses'      => $expenses,
            'net_profit'    => $netProfit,
            'net_margin'    => $revenue > 0 ? round(($netProfit / $revenue) * 100, 2) : 0,
        ]);
    }

    /** GET /reports/daily */
    public function dailyReport(Request $request): \Illuminate\Http\JsonResponse
    {
        $date     = $request->date ?? now()->toDateString();
        $branchId = $request->branch_id;

        $sales = Sale::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('completed_at', $date)
            ->with('payments', 'cashier:id,name,username', 'items')
            ->get();

        $cashSales = 0; $cardSales = 0; $mobileSales = 0; $otherSales = 0;
        foreach ($sales as $sale) {
            foreach ($sale->payments as $p) {
                match ($p->method) {
                    'cash'         => $cashSales  += $p->amount,
                    'card'         => $cardSales  += $p->amount,
                    'mobile_money' => $mobileSales += $p->amount,
                    default        => $otherSales += $p->amount,
                };
            }
        }

        $expenses = Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('expense_date', $date)->sum('amount');

        $cogs = SaleItem::whereIn('sale_id', $sales->pluck('id'))
            ->selectRaw('SUM(cost_price * quantity) as total')->value('total') ?? 0;

        $topProducts = SaleItem::whereIn('sale_id', $sales->pluck('id'))
            ->groupBy('product_id')
            ->selectRaw('product_id, SUM(quantity) as qty_sold, SUM(total) as revenue')
            ->with('product:id,name,sku')
            ->orderByDesc('revenue')->limit(10)->get();

        $cashierBreakdown = $sales->groupBy('user_id')->map(fn($g) => [
            'cashier'      => $g->first()->cashier?->name ?? 'Unknown',
            'username'     => $g->first()->cashier?->username ?? '-',
            'transactions' => $g->count(),
            'revenue'      => $g->sum('total'),
        ])->values();

        $shiftEnds = ShiftEnd::with('user:id,name,username')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('shift_end', $date)->get();

        $totalRevenue = $sales->sum('total');
        $grossProfit  = $totalRevenue - $cogs;
        $netProfit    = $grossProfit - $expenses;

        return $this->success([
            'date'               => $date,
            'total_revenue'      => $totalRevenue,
            'total_transactions' => $sales->count(),
            'cash_sales'         => $cashSales,
            'card_sales'         => $cardSales,
            'mobile_money_sales' => $mobileSales,
            'other_sales'        => $otherSales,
            'total_expenses'     => $expenses,
            'cogs'               => $cogs,
            'gross_profit'       => $grossProfit,
            'net_profit'         => $netProfit,
            'top_products'       => $topProducts,
            'cashier_breakdown'  => $cashierBreakdown,
            'shift_ends'         => $shiftEnds,
        ]);
    }

    /** GET /reports/monthly */
    public function monthlyReport(Request $request): \Illuminate\Http\JsonResponse
    {
        $month    = $request->month ?? now()->format('Y-m');
        $branchId = $request->branch_id;
        [$year, $mon] = explode('-', $month);
        $from = "{$year}-{$mon}-01";
        $to   = date('Y-m-t', strtotime($from));

        $sales = Sale::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to])
            ->with('payments', 'cashier:id,name,username')
            ->get();

        $cogs = SaleItem::whereIn('sale_id', $sales->pluck('id'))
            ->selectRaw('SUM(cost_price * quantity) as total')->value('total') ?? 0;

        $expenses = Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween('expense_date', [$from, $to])->sum('amount');

        $dailyBreakdown = $sales->groupBy(fn($s) => substr($s->completed_at, 0, 10))
            ->map(fn($g, $d) => ['date' => $d, 'transactions' => $g->count(), 'revenue' => $g->sum('total')])
            ->values()->sortBy('date')->values();

        $cashierBreakdown = $sales->groupBy('user_id')->map(fn($g) => [
            'cashier'      => $g->first()->cashier?->name ?? 'Unknown',
            'username'     => $g->first()->cashier?->username ?? '-',
            'transactions' => $g->count(),
            'revenue'      => $g->sum('total'),
        ])->values();

        $paymentBreakdown = [];
        foreach ($sales as $sale) {
            foreach ($sale->payments as $p) {
                $paymentBreakdown[$p->method] = ($paymentBreakdown[$p->method] ?? 0) + $p->amount;
            }
        }

        $revenue     = $sales->sum('total');
        $grossProfit = $revenue - $cogs;
        $netProfit   = $grossProfit - $expenses;

        return $this->success([
            'month'              => $month,
            'from'               => $from,
            'to'                 => $to,
            'total_revenue'      => $revenue,
            'total_transactions' => $sales->count(),
            'cogs'               => $cogs,
            'gross_profit'       => $grossProfit,
            'gross_margin'       => $revenue > 0 ? round(($grossProfit / $revenue) * 100, 2) : 0,
            'total_expenses'     => $expenses,
            'net_profit'         => $netProfit,
            'net_margin'         => $revenue > 0 ? round(($netProfit / $revenue) * 100, 2) : 0,
            'daily_breakdown'    => $dailyBreakdown,
            'cashier_breakdown'  => $cashierBreakdown,
            'payment_breakdown'  => $paymentBreakdown,
        ]);
    }

    /** GET /reports/stock-variances */
    public function stockVariances(Request $request): \Illuminate\Http\JsonResponse
    {
        $warehouseId = $request->warehouse_id;
        $from = $request->from ?? now()->subDays(30)->toDateString();
        $to   = $request->to   ?? now()->toDateString();

        $products = Product::with(['stocks' => fn($q) => $q->when($warehouseId, fn($s) => $s->where('warehouse_id', $warehouseId))])
            ->where('is_active', true)->get();

        $unitsSold = SaleItem::whereHas('sale', fn($q) =>
                $q->where('status', 'completed')
                  ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to]))
            ->groupBy('product_id')
            ->selectRaw('product_id, SUM(quantity) as units_sold, SUM(total) as revenue')
            ->get()->keyBy('product_id');

        $data = $products->map(function ($product) use ($warehouseId, $unitsSold) {
            $currentStock = $warehouseId
                ? $product->stocks->where('warehouse_id', $warehouseId)->sum('quantity')
                : $product->stocks->sum('quantity');
            $sold = $unitsSold[$product->id] ?? null;
            return [
                'id'            => $product->id,
                'name'          => $product->name,
                'sku'           => $product->sku,
                'current_stock' => $currentStock,
                'reorder_level' => $product->reorder_level,
                'units_sold'    => $sold?->units_sold ?? 0,
                'revenue'       => $sold?->revenue ?? 0,
                'stock_value'   => $currentStock * $product->cost_price,
                'is_low_stock'  => $currentStock <= $product->reorder_level,
                'is_out'        => $currentStock <= 0,
            ];
        })->sortByDesc('units_sold')->values();

        return $this->success([
            'from'              => $from,
            'to'                => $to,
            'products'          => $data,
            'total_stock_value' => $data->sum('stock_value'),
            'low_stock_count'   => $data->where('is_low_stock', true)->count(),
            'out_of_stock'      => $data->where('is_out', true)->count(),
        ]);
    }

    /** GET /reports/daily/pdf */
    public function dailyPdf(Request $request)
    {
        $date = $request->date ?? now()->toDateString();
        $data = json_decode($this->dailyReport($request)->getContent(), true)['data'] ?? [];
        $pdf  = Pdf::loadView('reports.daily', compact('data', 'date'))->setPaper('a4');
        return $pdf->download("daily-report-{$date}.pdf");
    }

    /** GET /reports/monthly/pdf */
    public function monthlyPdf(Request $request)
    {
        $month = $request->month ?? now()->format('Y-m');
        $data  = json_decode($this->monthlyReport($request)->getContent(), true)['data'] ?? [];
        $pdf   = Pdf::loadView('reports.monthly', compact('data', 'month'))->setPaper('a4');
        return $pdf->download("monthly-report-{$month}.pdf");
    }

    public function cashierPerformance(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate(['date_from' => 'required|date', 'date_to' => 'required|date']);

        $data = DB::table('sales')
            ->join('users', 'users.id', '=', 'sales.user_id')
            ->where('sales.status', 'completed')
            ->when($request->branch_id, fn($q) => $q->where('sales.branch_id', $request->branch_id))
            ->whereDate('sales.completed_at', '>=', $request->date_from)
            ->whereDate('sales.completed_at', '<=', $request->date_to)
            ->groupBy('sales.user_id', 'users.name')
            ->selectRaw('sales.user_id, users.name, COUNT(*) as transactions, SUM(sales.total) as revenue, AVG(sales.total) as avg_sale')
            ->orderByDesc('revenue')
            ->get();

        return $this->success($data);
    }
}
