<?php

namespace App\Http\Controllers\Api;

use App\Models\EndOfDay;
use App\Models\Sale;
use App\Models\Expense;
use App\Models\SaleItem;
use App\Models\ShiftEnd;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EndOfDayController extends BaseApiController
{
    /** GET /end-of-day/summary — live preview for manager */
    public function summary(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $request->branch_id ?? $request->user()->branch_id;
        $date     = $request->date ?? now()->toDateString();

        $sales = Sale::revenueCounted()
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('completed_at', $date)
            ->with('payments')
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

        // ->sum()/->value() bypass Eloquent's decimal casts (they don't hydrate a model), so
        // Postgres returns these as numeric strings — cast explicitly or they'll render as $0.00.
        $expenses = (float) Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('expense_date', $date)
            ->sum('amount');

        $totalRefunds = (float) DB::table('refunds')
            ->join('sales', 'sales.id', '=', 'refunds.sale_id')
            ->where('refunds.status', 'completed')
            ->when($branchId, fn($q) => $q->where('sales.branch_id', $branchId))
            ->whereDate('refunds.completed_at', $date)
            ->sum('refunds.amount');

        $totalSales  = $sales->sum('total');
        $cogs        = (float) (SaleItem::whereIn('sale_id', $sales->pluck('id'))
            ->selectRaw('SUM(cost_price * quantity) as total')->value('total') ?? 0);
        $grossProfit = $totalSales - $cogs;
        $netProfit   = $grossProfit - $expenses;
        $netRevenue  = $totalSales - $totalRefunds - $expenses;

        // Per-cashier breakdown
        $cashierBreakdown = Sale::revenueCounted()
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('completed_at', $date)
            ->with('cashier:id,name,username')
            ->groupBy('user_id')
            ->selectRaw('user_id, COUNT(*) as transactions, SUM(total) as revenue')
            ->get()
            ->map(function ($row) {
                $row->transactions = (int) $row->transactions;
                $row->revenue = (float) $row->revenue;
                return $row;
            });

        // Shift-end reconciliations closed during this day, for this branch —
        // lets the manager cross-check declared cash against each cashier's shift before closing the day.
        $shiftEnds = ShiftEnd::with('user:id,name,username')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereDate('shift_end', $date)
            ->get();

        return $this->success([
            'date'               => $date,
            'total_sales'        => $totalSales,
            'total_transactions' => $sales->count(),
            'cash_sales'         => $cashSales,
            'card_sales'         => $cardSales,
            'mobile_money_sales' => $mobileSales,
            'other_sales'        => $otherSales,
            'expected_cash'      => $cashSales,
            'total_expenses'     => $expenses,
            'total_refunds'      => $totalRefunds,
            'cogs'               => $cogs,
            'gross_profit'       => $grossProfit,
            'net_profit'         => $netProfit,
            'net_revenue'        => $netRevenue,
            'cashier_breakdown'  => $cashierBreakdown,
            'shift_ends'         => $shiftEnds,
        ]);
    }

    /** POST /end-of-day — manager submits EOD */
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'branch_id'    => 'required|exists:branches,id',
            'report_date'  => 'required|date',
            'opening_cash' => 'required|numeric|min:0',
            'actual_cash'  => 'required|numeric|min:0',
            'notes'        => 'nullable|string|max:1000',
        ]);

        // Prevent duplicate EOD for same branch+date
        if (EndOfDay::where('branch_id', $data['branch_id'])->where('report_date', $data['report_date'])->exists()) {
            return $this->error('End of day report already submitted for this date.', 422);
        }

        $sales = Sale::revenueCounted()
            ->where('branch_id', $data['branch_id'])
            ->whereDate('completed_at', $data['report_date'])
            ->with('payments')->get();

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

        $totalRefunds = DB::table('refunds')
            ->join('sales', 'sales.id', '=', 'refunds.sale_id')
            ->where('refunds.status', 'completed')
            ->where('sales.branch_id', $data['branch_id'])
            ->whereDate('refunds.completed_at', $data['report_date'])
            ->sum('refunds.amount');
        $totalExpenses = Expense::where('status', 'approved')
            ->where('branch_id', $data['branch_id'])
            ->whereDate('expense_date', $data['report_date'])->sum('amount');

        $expectedCash = $data['opening_cash'] + $cashSales - $totalRefunds;
        $difference   = $data['actual_cash'] - $expectedCash;

        $eod = EndOfDay::create([
            'branch_id'            => $data['branch_id'],
            'user_id'              => $request->user()->id,
            'report_date'          => $data['report_date'],
            'opening_cash'         => $data['opening_cash'],
            'cash_sales'           => $cashSales,
            'card_sales'           => $cardSales,
            'mobile_money_sales'   => $mobileSales,
            'other_sales'          => $otherSales,
            'total_sales'          => $sales->sum('total'),
            'total_refunds'        => $totalRefunds,
            'total_expenses'       => $totalExpenses,
            'expected_cash'        => $expectedCash,
            'actual_cash'          => $data['actual_cash'],
            'difference'           => $difference,
            'notes'                => $data['notes'] ?? null,
            'status'               => 'closed',
        ]);

        return $this->success($eod->load('user', 'branch'), 'End of day submitted successfully', 201);
    }

    /** GET /end-of-day — list EOD reports */
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = EndOfDay::with('user:id,name,username', 'branch:id,name')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->month, function ($q) use ($request) {
                [$year, $month] = explode('-', $request->month);
                $q->whereYear('report_date', $year)->whereMonth('report_date', $month);
            });

        return $this->paginated($query->orderByDesc('report_date')->paginate($request->per_page ?? 31));
    }
}
