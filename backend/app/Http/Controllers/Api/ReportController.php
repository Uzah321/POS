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
        $branchId = $this->effectiveBranchId($request);
        $cacheKey = 'dashboard:' . ($branchId ?: 'all');

        $payload = Cache::remember($cacheKey, now()->addSeconds(30), function () use ($branchId) {
            $today = now()->toDateString();
            $thisMonth = now()->startOfMonth()->toDateString();

            $todaySales = Sale::revenueCounted()
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->whereDate('completed_at', $today)
                ->get(['total']);

            $monthSales = Sale::revenueCounted()
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->whereDate('completed_at', '>=', $thisMonth)
                ->get(['total']);

            $monthCustomers = Sale::revenueCounted()
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->whereDate('completed_at', '>=', $thisMonth)
                ->whereNotNull('customer_id')
                ->distinct('customer_id')
                ->count('customer_id');

            $lowStockCount = Stock::query()
                ->join('products', 'products.id', '=', 'stocks.product_id')
                ->where('products.is_active', true)
                ->when($branchId, fn($q) => $q->where('products.branch_id', $branchId))
                ->whereColumn('stocks.quantity', '<=', 'products.reorder_level')
                ->count();

            // Sales by day (last 30 days)
            // Raw SUM()/COUNT() aggregates come back from the DB driver as strings (not
            // covered by the model's decimal casts), so they must be cast explicitly here —
            // otherwise the frontend's `typeof x === 'number'` currency check silently zeroes them.
            $salesTrend = Sale::revenueCounted()
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->where('completed_at', '>=', now()->subDays(30))
                ->groupBy(DB::raw('DATE(completed_at)'))
                ->selectRaw('DATE(completed_at) as date, SUM(total) as revenue, COUNT(*) as transactions')
                ->orderBy('date')
                ->get()
                ->map(fn($row) => [
                    'date' => $row->date,
                    'revenue' => (float) $row->revenue,
                    'transactions' => (int) $row->transactions,
                ]);

            // Top products (last 30 days)
            $topProducts = SaleItem::whereHas('sale', fn($q) =>
                    $q->whereIn('status', Sale::REVENUE_STATUSES)
                      ->when($branchId, fn($sq) => $sq->where('branch_id', $branchId))
                      ->where('completed_at', '>=', now()->subDays(30))
                )
                ->groupBy('product_id')
                ->selectRaw('product_id, SUM(quantity) as total_qty, SUM(total) as total_revenue')
                ->with('product:id,name,image,sku')
                ->orderByDesc('total_revenue')
                ->limit(5)
                ->get()
                ->map(function ($row) {
                    $row->total_qty = (float) $row->total_qty;
                    $row->total_revenue = (float) $row->total_revenue;
                    return $row;
                });

            // Payment method breakdown today
            $paymentBreakdown = DB::table('sale_payments')
                ->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
                ->whereIn('sales.status', Sale::REVENUE_STATUSES)
                ->when($branchId, fn($q) => $q->where('sales.branch_id', $branchId))
                ->whereDate('sales.completed_at', $today)
                ->groupBy('sale_payments.method')
                ->selectRaw('sale_payments.method, SUM(sale_payments.amount) as total')
                ->get()
                ->map(fn($row) => [
                    'method' => $row->method,
                    'total' => (float) $row->total,
                ]);

            return [
                'today' => [
                    'revenue' => $todaySales->sum('total'),
                    'transactions' => $todaySales->count(),
                    'avg_sale' => $todaySales->count() > 0 ? $todaySales->sum('total') / $todaySales->count() : 0,
                ],
                'month' => [
                    'revenue' => $monthSales->sum('total'),
                    'transactions' => $monthSales->count(),
                    'customers' => $monthCustomers,
                ],
                'low_stock_count'  => $lowStockCount,
                'total_products'   => Product::when($branchId, fn($q) => $q->where('branch_id', $branchId))->count(),
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

        $branchId = $this->effectiveBranchId($request);
        $query = Sale::with('cashier:id,name', 'branch:id,name', 'customer:id,name')
            ->revenueCounted()
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
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

        $dailyBreakdown = (clone $query)
            ->reorder()
            ->selectRaw('DATE(completed_at) as date, COUNT(*) as transactions, SUM(total) as revenue')
            ->groupBy(DB::raw('DATE(completed_at)'))
            ->orderBy('date')
            ->get();

        return $this->success([
            'sales' => $sales,
            'summary' => $summary,
            'daily_breakdown' => $dailyBreakdown,
        ]);
    }

    public function inventoryReport(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);
        // 'stocks.warehouse' is never read below — only stocks.quantity is
        // summed — so eager-loading each stock row's warehouse just doubled
        // the query cost for no reason.
        $products = Product::with('category', 'brand', 'stocks')
            ->where('is_active', true)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->when($request->category_id, fn($q) => $q->where('category_id', $request->category_id))
            ->when($request->warehouse_id, fn($q) => $q->whereHas('stocks', fn($s) => $s->where('warehouse_id', $request->warehouse_id)))
            ->get()
            ->map(function ($product) use ($request) {
                $stockQty = $request->warehouse_id
                    ? $product->stocks->where('warehouse_id', $request->warehouse_id)->sum('quantity')
                    : $product->stocks->sum('quantity');

                // Untracked items (services, made-to-order) never carry a meaningful
                // quantity — matches the "out"/"low" definition used by
                // InventoryController::stockLevels and the Products page, so a
                // product doesn't read as low/out here while showing fine everywhere else.
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
                    'is_low_stock'  => $product->track_stock && $stockQty > 0 && $stockQty <= $product->reorder_level,
                    'is_out'        => $product->track_stock && $stockQty <= 0,
                ];
            });

        $summary = [
            'total_products'   => $products->count(),
            'total_stock_value'=> $products->sum('stock_value'),
            'low_stock_count'  => $products->where('is_low_stock', true)->count(),
            'out_of_stock'     => $products->where('is_out', true)->count(),
        ];

        return $this->success(compact('products', 'summary'));
    }

    public function profitLoss(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to'   => 'required|date',
        ]);

        $branchId = $this->effectiveBranchId($request);
        $revenue = Sale::revenueCounted()
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('completed_at', '>=', $request->date_from)
            ->whereDate('completed_at', '<=', $request->date_to)
            ->sum('total');

        $cogs = SaleItem::whereHas('sale', fn($q) =>
                $q->whereIn('status', Sale::REVENUE_STATUSES)
                  ->when($branchId, fn($sq) => $sq->where('branch_id', $branchId))
                  ->whereDate('completed_at', '>=', $request->date_from)
                  ->whereDate('completed_at', '<=', $request->date_to)
            )
            ->selectRaw('SUM(cost_price * quantity) as total')
            ->value('total') ?? 0;

        $expenses = Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
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
        $branchId = $this->effectiveBranchId($request);

        $sales = Sale::revenueCounted()
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
        $branchId = $this->effectiveBranchId($request);
        [$year, $mon] = explode('-', $month);
        $from = "{$year}-{$mon}-01";
        $to   = date('Y-m-t', strtotime($from));

        $sales = Sale::revenueCounted()
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
        $branchId = $this->effectiveBranchId($request);
        $from = $request->date_from ?? $request->from ?? now()->subDays(30)->toDateString();
        $to   = $request->date_to ?? $request->to ?? now()->toDateString();

        $products = Product::with([
                'category:id,name',
                'stocks' => fn($q) => $q->when($warehouseId, fn($s) => $s->where('warehouse_id', $warehouseId)),
            ])
            ->where('is_active', true)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
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
                'is_low_stock'  => $product->track_stock && $currentStock > 0 && $currentStock <= $product->reorder_level,
                'is_out'        => $product->track_stock && $currentStock <= 0,
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

    /**
     * Cashier Activity report: completed-sale revenue plus refunds, voids, and
     * shift-end closures per cashier for a date range — so admins can see the
     * full picture, not just revenue.
     */
    public function cashierPerformance(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate(['date_from' => 'required|date', 'date_to' => 'required|date']);
        $branchId = $this->effectiveBranchId($request);

        $sales = DB::table('sales')
            ->join('users', 'users.id', '=', 'sales.user_id')
            ->whereIn('sales.status', Sale::REVENUE_STATUSES)
            ->when($branchId, fn($q) => $q->where('sales.branch_id', $branchId))
            ->whereDate('sales.completed_at', '>=', $request->date_from)
            ->whereDate('sales.completed_at', '<=', $request->date_to)
            ->groupBy('sales.user_id', 'users.name')
            ->selectRaw('sales.user_id, users.name, COUNT(*) as transactions, SUM(sales.total) as revenue, AVG(sales.total) as avg_sale')
            ->get()
            ->keyBy('user_id');

        $voids = DB::table('sales')
            ->where('status', 'voided')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('updated_at', '>=', $request->date_from)
            ->whereDate('updated_at', '<=', $request->date_to)
            ->groupBy('user_id')
            ->selectRaw('user_id, COUNT(*) as void_count')
            ->pluck('void_count', 'user_id');

        $refunds = DB::table('refunds')
            ->join('sales', 'sales.id', '=', 'refunds.sale_id')
            ->where('refunds.status', 'completed')
            ->when($branchId, fn($q) => $q->where('sales.branch_id', $branchId))
            ->whereDate('refunds.created_at', '>=', $request->date_from)
            ->whereDate('refunds.created_at', '<=', $request->date_to)
            ->groupBy('refunds.user_id')
            ->selectRaw('refunds.user_id, COUNT(*) as refund_count, SUM(refunds.amount) as refund_amount')
            ->get()
            ->keyBy('user_id');

        $shiftEnds = DB::table('shift_ends')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('shift_end', '>=', $request->date_from)
            ->whereDate('shift_end', '<=', $request->date_to)
            ->groupBy('user_id')
            ->selectRaw("user_id, COUNT(*) as shifts_closed, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as shifts_pending_approval")
            ->get()
            ->keyBy('user_id');

        // Union of every user_id that appears anywhere, so a cashier with only
        // refunds/voids/shift-ends (no completed sales) still shows up.
        $userIds = collect()
            ->merge($sales->keys())
            ->merge($voids->keys())
            ->merge($refunds->keys())
            ->merge($shiftEnds->keys())
            ->unique()
            ->values();

        $userNames = DB::table('users')->whereIn('id', $userIds)->pluck('name', 'id');

        $data = $userIds->map(function ($userId) use ($sales, $voids, $refunds, $shiftEnds, $userNames) {
            $s  = $sales->get($userId);
            $r  = $refunds->get($userId);
            $se = $shiftEnds->get($userId);
            return [
                'user_id'                 => $userId,
                'name'                    => $s->name ?? $userNames->get($userId),
                'transactions'            => (int) ($s->transactions ?? 0),
                'revenue'                 => (float) ($s->revenue ?? 0),
                'avg_sale'                => (float) ($s->avg_sale ?? 0),
                'voids'                   => (int) ($voids->get($userId) ?? 0),
                'refund_count'            => (int) ($r->refund_count ?? 0),
                'refund_amount'           => (float) ($r->refund_amount ?? 0),
                'shifts_closed'           => (int) ($se->shifts_closed ?? 0),
                'shifts_pending_approval' => (int) ($se->shifts_pending_approval ?? 0),
            ];
        })->sortByDesc('revenue')->values();

        return $this->success($data);
    }

    public function lowStock(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);

        // Aggregate stock per product and filter in SQL instead of loading every
        // active product's full stock history into PHP and reducing it there —
        // mirrors the same SUM/threshold logic dashboard() already does in SQL.
        $products = \App\Models\Product::query()
            ->select('products.id', 'products.name', 'products.sku', 'products.reorder_level')
            ->selectRaw('COALESCE(SUM(stocks.quantity), 0) as stock')
            ->leftJoin('stocks', 'stocks.product_id', '=', 'products.id')
            ->where('products.is_active', true)
            ->when($branchId, fn($q) => $q->where('products.branch_id', $branchId))
            ->groupBy('products.id', 'products.name', 'products.sku', 'products.reorder_level')
            // reorder_point/alert_threshold are unused, always-default columns —
            // reorder_level is the one every other report/page in the app actually
            // reads and lets the user customize per product.
            // CASE WHEN instead of GREATEST()/MAX(a,b) — this app runs on
            // SQLite (offline), Postgres, and MySQL/MariaDB, and only CASE WHEN
            // is portable across all three for a scalar "at least 1" floor.
            ->havingRaw('COALESCE(SUM(stocks.quantity), 0) <= CASE WHEN products.reorder_level > 1 THEN products.reorder_level ELSE 1 END')
            ->get()
            ->map(fn($p) => [
                'id'            => $p->id,
                'name'          => $p->name,
                'sku'           => $p->sku,
                'stock'         => (float) $p->stock,
                'reorder_level' => $p->reorder_level ?? 0,
            ]);

        return $this->success($products);
    }

    public function vatReport(Request $request): \Illuminate\Http\JsonResponse
    {
        $from = $request->from ?? now()->startOfMonth()->toDateString();
        $to   = $request->to   ?? now()->toDateString();

        $sales = Sale::revenueCounted()
            ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to])
            ->selectRaw('DATE(completed_at) as date, SUM(tax_amount) as vat_collected, SUM(total) as gross_total, COUNT(*) as sale_count')
            ->groupByRaw('DATE(completed_at)')
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
    public function financialSummary(Request $request): \Illuminate\Http\JsonResponse|\Symfony\Component\HttpFoundation\StreamedResponse
    {
        $period   = $request->period ?? 'daily';
        $branchId = $this->effectiveBranchId($request);

        if ($period === 'monthly') {
            $month = $request->month ?? now()->format('Y-m');
            [$year, $mon] = explode('-', $month);
            $from = "{$year}-{$mon}-01";
            $to   = date('Y-m-t', strtotime($from));
        } else {
            $from = $request->date_from ?? $request->date ?? now()->toDateString();
            $to   = $request->date_to   ?? $request->date ?? now()->toDateString();
        }

        $sales = Sale::revenueCounted()
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to])
            ->get(['id', 'total', 'discount_amount', 'tax_amount', 'user_id', 'completed_at']);

        $revenue = $sales->sum('total');

        $cogs = SaleItem::whereIn('sale_id', $sales->pluck('id'))
            ->selectRaw('SUM(cost_price * quantity) as total')
            ->value('total') ?? 0;

        // If cost_price was not recorded on sale items (legacy zero), derive COGS
        // from the product's current cost_price as a best-effort fallback.
        if ((float) $cogs === 0.0 && $sales->count() > 0) {
            $cogs = SaleItem::whereIn('sale_id', $sales->pluck('id'))
                ->join('products', 'products.id', '=', 'sale_items.product_id')
                ->selectRaw('SUM(products.cost_price * sale_items.quantity) as total')
                ->value('total') ?? 0;
        }

        $expenses = Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween('expense_date', [$from, $to])
            ->sum('amount');

        // Payment breakdown
        $paymentBreakdown = DB::table('sale_payments')
            ->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
            ->whereIn('sales.status', Sale::REVENUE_STATUSES)
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
        $branchId = $this->effectiveBranchId($request);

        $sales = Sale::revenueCounted()
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
        $branchId = $this->effectiveBranchId($request);
        [$year, $mon] = explode('-', $month);
        $from = "{$year}-{$mon}-01";
        $to   = date('Y-m-t', strtotime($from));

        $sales = Sale::revenueCounted()
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

        // Three grouped queries (revenue+transactions, COGS, expenses) instead of
        // 1 + 3-per-branch — this used to run 1+3N queries, scaling linearly with
        // branch count. Grouping by branch_id here scales with data volume, not N.
        $revenueByBranch = Sale::revenueCounted()
            ->whereBetween(DB::raw('DATE(completed_at)'), [$from, $to])
            ->groupBy('branch_id')
            ->selectRaw('branch_id, SUM(total) as revenue, COUNT(*) as transactions')
            ->get()->keyBy('branch_id');

        $cogsByBranch = SaleItem::join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->whereIn('sales.status', Sale::REVENUE_STATUSES)
            ->whereBetween(DB::raw('DATE(sales.completed_at)'), [$from, $to])
            ->groupBy('sales.branch_id')
            ->selectRaw('sales.branch_id, SUM(sale_items.cost_price * sale_items.quantity) as cogs')
            ->get()->keyBy('branch_id');

        $expensesByBranch = Expense::where('status', 'approved')
            ->whereBetween('expense_date', [$from, $to])
            ->groupBy('branch_id')
            ->selectRaw('branch_id, SUM(amount) as expenses')
            ->get()->keyBy('branch_id');

        $result = [];
        foreach ($branches as $branch) {
            $revenue      = (float) ($revenueByBranch->get($branch->id)->revenue ?? 0);
            $transactions = (int) ($revenueByBranch->get($branch->id)->transactions ?? 0);
            $cogs         = (float) ($cogsByBranch->get($branch->id)->cogs ?? 0);
            $expenses     = (float) ($expensesByBranch->get($branch->id)->expenses ?? 0);

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
                'transactions' => $transactions,
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
