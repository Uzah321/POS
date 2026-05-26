<?php

namespace App\Http\Controllers\Api;

use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Expense;
use App\Models\Product;
use App\Models\Stock;
use App\Models\Customer;
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
