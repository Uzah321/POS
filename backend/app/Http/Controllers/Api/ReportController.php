<?php

namespace App\Http\Controllers\Api;

use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Expense;
use App\Models\Product;
use App\Models\Stock;
use App\Models\Customer;
use App\Models\ShiftEnd;
use App\Models\Branch;
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
                'low_stock_count'  => $lowStockCount,
                'total_products'   => Product::count(),
                'total_customers'  => Customer::count(),
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
                    'is_out'        => $stockQty <= 0,
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
        $categoryId = $request->category_id;
        $branchId = $request->branch_id;
        $from = $request->date_from ?? $request->from ?? now()->subDays(30)->toDateString();
        $to   = $request->date_to ?? $request->to ?? now()->toDateString();

        $products = Product::with([
                'category:id,name',
                'stocks' => fn($q) => $q->when($warehouseId, fn($s) => $s->where('warehouse_id', $warehouseId)),
            ])
            ->where('is_active', true)
            ->when($categoryId, fn($q) => $q->where('category_id', $categoryId))
            ->get();

        $unitsSold = SaleItem::whereHas('sale', fn($q) =>
                $q->where('status', 'completed')
                  ->when($branchId, fn($sq) => $sq->where('branch_id', $branchId))
                  ->when($warehouseId, fn($sq) => $sq->where('warehouse_id', $warehouseId))
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
                'category'      => $product->category?->name,
                'current_stock' => $currentStock,
                'reorder_level' => $product->reorder_level,
                'units_sold'    => $sold?->units_sold ?? 0,
                'revenue'       => $sold?->revenue ?? 0,
                'stock_value'   => $currentStock * $product->cost_price,
                'is_low_stock'  => $currentStock <= $product->reorder_level,
                'is_out'        => $currentStock <= 0,
            ];
        })->sortBy([
            ['category', 'asc'],
            ['name', 'asc'],
        ])->values();

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

    public function lowStock(Request $request): \Illuminate\Http\JsonResponse
    {
        $products = \App\Models\Product::with('stocks')
            ->where('is_active', true)
            ->get()
            ->filter(function ($p) {
                $qty       = $p->stocks->sum('quantity');
                $reorder   = (float) ($p->reorder_point   ?? $p->reorder_level   ?? 0);
                $alert     = (float) ($p->alert_threshold ?? $p->min_stock_level ?? 0);
                $threshold = max($reorder, $alert, 1);
                return $qty <= $threshold;
            })
            ->values()
            ->map(function ($p) {
                return [
                    'id'              => $p->id,
                    'name'            => $p->name,
                    'sku'             => $p->sku,
                    'stock'           => (float) $p->stocks->sum('quantity'),
                    'reorder_point'   => $p->reorder_point   ?? 0,
                    'alert_threshold' => $p->alert_threshold ?? 0,
                ];
            });
        return $this->success($products);
    }

    public function vatReport(Request $request): \Illuminate\Http\JsonResponse
    {
        $from = $request->from ?? now()->startOfMonth()->toDateString();
        $to   = $request->to   ?? now()->toDateString();

        $sales = \App\Models\Sale::whereBetween(\DB::raw('DATE(created_at)'), [$from, $to])
            ->where('status', 'completed')
            ->selectRaw('DATE(created_at) as date, SUM(tax_amount) as vat_collected, SUM(total) as gross_total, COUNT(*) as sale_count')
            ->groupByRaw('DATE(created_at)')
            ->orderBy('date')
            ->get();

        $totals = [
            'total_vat'   => $sales->sum('vat_collected'),
            'gross_total' => $sales->sum('gross_total'),
            'sale_count'  => $sales->sum('sale_count'),
        ];

        return $this->success(['rows' => $sales, 'totals' => $totals, 'from' => $from, 'to' => $to]);
    }

    /**
     * GET /reports/financial-summary
     * Returns P&L in the standard format:
     * Sales → Less CoS → Gross Profit → %GP → Less Deductions → Profit B/d
     * Supports period=daily|weekly|monthly and date/month params.
     */
    public function financialSummary(Request $request): \Illuminate\Http\JsonResponse
    {
        $period   = $request->period ?? 'daily';
        $branchId = $request->branch_id;

        if ($period === 'monthly') {
            $month = $request->month ?? now()->format('Y-m');
            [$year, $mon] = explode('-', $month);
            $from = "{$year}-{$mon}-01";
            $to   = date('Y-m-t', strtotime($from));
        } else {
            $from = $request->date_from ?? $request->date ?? now()->toDateString();
            $to   = $request->date_to   ?? $request->date ?? now()->toDateString();
        }

        $sales = Sale::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to])
            ->get(['id', 'total', 'discount_amount', 'tax_amount', 'user_id', 'completed_at']);

        $revenue = $sales->sum('total');

        $cogs = SaleItem::whereIn('sale_id', $sales->pluck('id'))
            ->selectRaw('SUM(cost_price * quantity) as total')
            ->value('total') ?? 0;

        $expenses = Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween('expense_date', [$from, $to])
            ->sum('amount');

        // Payment breakdown
        $paymentBreakdown = DB::table('sale_payments')
            ->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
            ->where('sales.status', 'completed')
            ->when($branchId, fn($q) => $q->where('sales.branch_id', $branchId))
            ->whereBetween(DB::raw('DATE(sales.completed_at)'), [$from, $to])
            ->groupBy('sale_payments.method')
            ->selectRaw('sale_payments.method, SUM(sale_payments.amount) as total')
            ->get()->keyBy('method');

        $grossProfit = $revenue - $cogs;
        $netProfit   = $grossProfit - $expenses;
        $gpPercent   = $revenue > 0 ? round(($grossProfit / $revenue) * 100, 2) : 0;

        // Daily breakdown for charts
        $dailyBreakdown = $sales->groupBy(fn($s) => substr($s->completed_at, 0, 10))
            ->map(fn($g, $d) => ['date' => $d, 'transactions' => $g->count(), 'revenue' => $g->sum('total')])
            ->values()->sortBy('date')->values();

        if ($request->export === 'csv') {
            return $this->exportFinancialCsv($from, $to, $revenue, $cogs, $grossProfit, $gpPercent, $expenses, $netProfit, $dailyBreakdown);
        }

        return $this->success([
            'period'            => $period,
            'from'              => $from,
            'to'                => $to,
            // P&L lines matching the required format
            'sales'             => $revenue,
            'less_cost_of_sales'=> $cogs,
            'gross_profit'      => $grossProfit,
            'gp_percent'        => $gpPercent,
            'less_deductions'   => $expenses,
            'profit_bd'         => $netProfit,
            // Additional detail
            'total_transactions'=> $sales->count(),
            'total_discount'    => $sales->sum('discount_amount'),
            'total_tax'         => $sales->sum('tax_amount'),
            'payment_breakdown' => $paymentBreakdown,
            'daily_breakdown'   => $dailyBreakdown,
        ]);
    }

    /** GET /reports/daily/csv */
    public function dailyCsv(Request $request)
    {
        $date     = $request->date ?? now()->toDateString();
        $branchId = $request->branch_id;

        $sales = Sale::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('completed_at', $date)
            ->with('cashier:id,name', 'items')
            ->get();

        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"daily-sales-{$date}.csv\"",
            'Cache-Control'       => 'no-cache',
        ];

        $cogs = SaleItem::whereIn('sale_id', $sales->pluck('id'))
            ->selectRaw('SUM(cost_price * quantity) as total')->value('total') ?? 0;
        $expenses = Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('expense_date', $date)->sum('amount');
        $revenue     = $sales->sum('total');
        $grossProfit = $revenue - $cogs;
        $netProfit   = $grossProfit - $expenses;

        $callback = function () use ($sales, $date, $revenue, $cogs, $grossProfit, $expenses, $netProfit) {
            $f = fopen('php://output', 'w');
            // P&L Summary
            fputcsv($f, ["DAILY SALES REPORT - {$date}"]);
            fputcsv($f, []);
            fputcsv($f, ['Sales', number_format($revenue, 2)]);
            fputcsv($f, ['Less Cost of Sales', number_format($cogs, 2)]);
            fputcsv($f, ['Gross Profit', number_format($grossProfit, 2)]);
            fputcsv($f, ['% GP', $revenue > 0 ? round(($grossProfit / $revenue) * 100, 2) . '%' : '0%']);
            fputcsv($f, ['Less Deductions', number_format($expenses, 2)]);
            fputcsv($f, ['Profit B/d', number_format($netProfit, 2)]);
            fputcsv($f, []);
            // Transaction detail
            fputcsv($f, ['Reference', 'Cashier', 'Time', 'Items', 'Discount', 'Tax', 'Total']);
            foreach ($sales as $s) {
                fputcsv($f, [
                    $s->reference,
                    $s->cashier?->name ?? '',
                    substr($s->completed_at, 11, 5),
                    $s->items->count(),
                    $s->discount_amount,
                    $s->tax_amount,
                    $s->total,
                ]);
            }
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }

    /** GET /reports/monthly/csv */
    public function monthlyCsv(Request $request)
    {
        $month    = $request->month ?? now()->format('Y-m');
        $branchId = $request->branch_id;
        [$year, $mon] = explode('-', $month);
        $from = "{$year}-{$mon}-01";
        $to   = date('Y-m-t', strtotime($from));

        $sales = Sale::where('status', 'completed')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to])
            ->with('cashier:id,name')
            ->get();

        $cogs     = SaleItem::whereIn('sale_id', $sales->pluck('id'))->selectRaw('SUM(cost_price * quantity) as total')->value('total') ?? 0;
        $expenses = Expense::where('status', 'approved')->when($branchId, fn($q) => $q->where('branch_id', $branchId))->whereBetween('expense_date', [$from, $to])->sum('amount');
        $revenue  = $sales->sum('total');
        $gross    = $revenue - $cogs;
        $net      = $gross - $expenses;

        $dailyBreakdown = $sales->groupBy(fn($s) => substr($s->completed_at, 0, 10))
            ->map(fn($g, $d) => ['date' => $d, 'transactions' => $g->count(), 'revenue' => $g->sum('total')])
            ->values()->sortBy('date')->values();

        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"monthly-report-{$month}.csv\"",
            'Cache-Control'       => 'no-cache',
        ];

        $callback = function () use ($month, $from, $to, $revenue, $cogs, $gross, $expenses, $net, $dailyBreakdown) {
            $f = fopen('php://output', 'w');
            fputcsv($f, ["MONTHLY SALES REPORT - {$month} ({$from} to {$to})"]);
            fputcsv($f, []);
            fputcsv($f, ['Sales', number_format($revenue, 2)]);
            fputcsv($f, ['Less Cost of Sales', number_format($cogs, 2)]);
            fputcsv($f, ['Gross Profit', number_format($gross, 2)]);
            fputcsv($f, ['% GP', $revenue > 0 ? round(($gross / $revenue) * 100, 2) . '%' : '0%']);
            fputcsv($f, ['Less Deductions', number_format($expenses, 2)]);
            fputcsv($f, ['Profit B/d', number_format($net, 2)]);
            fputcsv($f, []);
            fputcsv($f, ['Date', 'Transactions', 'Revenue']);
            foreach ($dailyBreakdown as $d) {
                fputcsv($f, [$d['date'], $d['transactions'], $d['revenue']]);
            }
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }

    /** GET /reports/branch-consolidation — all branches P&L side by side */
    public function branchConsolidation(Request $request): \Illuminate\Http\JsonResponse
    {
        $from = $request->date_from ?? now()->startOfMonth()->toDateString();
        $to   = $request->date_to   ?? now()->toDateString();

        $branches = Branch::all();
        $result   = [];

        foreach ($branches as $branch) {
            $sales = Sale::where('status', 'completed')
                ->where('branch_id', $branch->id)
                ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to])
                ->get(['id', 'total']);

            $revenue = $sales->sum('total');

            $cogs = SaleItem::whereIn('sale_id', $sales->pluck('id'))
                ->selectRaw('SUM(cost_price * quantity) as total')
                ->value('total') ?? 0;

            $expenses = Expense::where('status', 'approved')
                ->where('branch_id', $branch->id)
                ->whereBetween('expense_date', [$from, $to])
                ->sum('amount');

            $gross = $revenue - $cogs;
            $net   = $gross - $expenses;

            $result[] = [
                'branch_id'    => $branch->id,
                'branch_name'  => $branch->name,
                'sales'        => round($revenue, 2),
                'cogs'         => round($cogs, 2),
                'gross_profit' => round($gross, 2),
                'gp_percent'   => $revenue > 0 ? round(($gross / $revenue) * 100, 2) : 0,
                'expenses'     => round($expenses, 2),
                'net_profit'   => round($net, 2),
                'transactions' => $sales->count(),
            ];
        }

        $totals = [
            'sales'        => round(array_sum(array_column($result, 'sales')), 2),
            'cogs'         => round(array_sum(array_column($result, 'cogs')), 2),
            'gross_profit' => round(array_sum(array_column($result, 'gross_profit')), 2),
            'expenses'     => round(array_sum(array_column($result, 'expenses')), 2),
            'net_profit'   => round(array_sum(array_column($result, 'net_profit')), 2),
            'transactions' => array_sum(array_column($result, 'transactions')),
        ];

        return $this->success(compact('result', 'totals', 'from', 'to') + ['branches' => $result]);
    }

    private function exportFinancialCsv($from, $to, $revenue, $cogs, $grossProfit, $gpPercent, $expenses, $netProfit, $dailyBreakdown)
    {
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"financial-report-{$from}-to-{$to}.csv\"",
            'Cache-Control'       => 'no-cache',
        ];

        $callback = function () use ($from, $to, $revenue, $cogs, $grossProfit, $gpPercent, $expenses, $netProfit, $dailyBreakdown) {
            $f = fopen('php://output', 'w');
            fputcsv($f, ["FINANCIAL REPORT ({$from} to {$to})"]);
            fputcsv($f, []);
            fputcsv($f, ['Item', 'Amount']);
            fputcsv($f, ['Sales', number_format($revenue, 2)]);
            fputcsv($f, ['Less Cost of Sales', number_format($cogs, 2)]);
            fputcsv($f, ['Gross Profit', number_format($grossProfit, 2)]);
            fputcsv($f, ['% GP', $gpPercent . '%']);
            fputcsv($f, ['Less Deductions', number_format($expenses, 2)]);
            fputcsv($f, ['Profit B/d', number_format($netProfit, 2)]);
            fputcsv($f, []);
            fputcsv($f, ['Daily Breakdown']);
            fputcsv($f, ['Date', 'Transactions', 'Revenue']);
            foreach ($dailyBreakdown as $d) {
                fputcsv($f, [$d['date'], $d['transactions'], $d['revenue']]);
            }
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }
}
