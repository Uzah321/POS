<?php

namespace App\Http\Controllers\Api;

use App\Models\ShiftEnd;
use App\Models\Sale;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ShiftEndController extends BaseApiController
{
    /** GET /shift-end/summary — cashier gets a live preview of their current shift */
    public function summary(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $request->user();

        // Find last shift end to determine shift_start
        $lastShift = ShiftEnd::where('user_id', $user->id)->latest()->first();
        $shiftStart = $lastShift ? $lastShift->shift_end : now()->startOfDay();

        $sales = Sale::where('user_id', $user->id)
            ->revenueCounted()
            ->where('completed_at', '>=', $shiftStart)
            ->with('payments')
            ->get();

        $cashSales  = 0;
        $cardSales  = 0;
        $mobileSales = 0;
        $otherSales = 0;

        foreach ($sales as $sale) {
            foreach ($sale->payments as $payment) {
                match ($payment->method) {
                    'cash'         => $cashSales  += $payment->amount,
                    'card'         => $cardSales  += $payment->amount,
                    'mobile_money' => $mobileSales += $payment->amount,
                    default        => $otherSales += $payment->amount,
                };
            }
        }

        $salesList = $sales->map(fn($s) => [
            'id'           => $s->id,
            'reference'    => $s->reference ?? $s->receipt_number ?? '#' . $s->id,
            'completed_at' => $s->completed_at,
            'total'        => $s->total,
            'items_count'  => $s->items_count ?? $s->items?->count() ?? 0,
            'payments'     => $s->payments->map(fn($p) => ['method' => $p->method, 'amount' => $p->amount]),
        ]);

        return $this->success([
            'shift_start'        => $shiftStart,
            'total_sales'        => $sales->sum('total'),
            'total_transactions' => $sales->count(),
            'cash_sales'         => $cashSales,
            'card_sales'         => $cardSales,
            'mobile_money_sales' => $mobileSales,
            'other_sales'        => $otherSales,
            'expected_cash'      => $cashSales,
            'sales'              => $salesList,
        ]);
    }

    /** POST /shift-end — cashier submits their shift end */
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'branch_id'     => 'nullable|exists:branches,id',
            'declared_cash' => 'required|numeric|min:0',
            'notes'         => 'nullable|string|max:1000',
        ]);

        // Fall back to the cashier's assigned branch
        $data['branch_id'] = $data['branch_id'] ?? $user->branch_id;

        $lastShift  = ShiftEnd::where('user_id', $user->id)->latest()->first();
        $shiftStart = $lastShift ? $lastShift->shift_end : now()->startOfDay();

        $sales = Sale::where('user_id', $user->id)
            ->revenueCounted()
            ->where('completed_at', '>=', $shiftStart)
            ->with('payments')
            ->get();

        $cashSales  = 0; $cardSales = 0; $mobileSales = 0; $otherSales = 0;
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

        $expectedCash = $cashSales;
        $variance     = $data['declared_cash'] - $expectedCash;

        $shiftEnd = ShiftEnd::create([
            'branch_id'          => $data['branch_id'],
            'user_id'            => $user->id,
            'shift_start'        => $shiftStart,
            'shift_end'          => now(),
            'total_sales'        => $sales->sum('total'),
            'cash_sales'         => $cashSales,
            'card_sales'         => $cardSales,
            'mobile_money_sales' => $mobileSales,
            'other_sales'        => $otherSales,
            'total_transactions' => $sales->count(),
            'declared_cash'      => $data['declared_cash'],
            'expected_cash'      => $expectedCash,
            'variance'           => $variance,
            'notes'              => $data['notes'] ?? null,
            'status'             => 'pending',
        ]);

        return $this->success($shiftEnd->load('user', 'branch'), 'Shift closed successfully', 201);
    }

    /** GET /shift-end — list shift ends (admin/manager sees all, cashier sees own) */
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $user  = $request->user();
        $query = ShiftEnd::with('user:id,name,username', 'branch:id,name', 'approvedBy:id,name')
            ->when(! $user->hasRole(['admin', 'manager']), fn($q) => $q->where('user_id', $user->id))
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->date, fn($q) => $q->whereDate('shift_end', $request->date))
            ->when($request->date_from, fn($q) => $q->whereDate('shift_end', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('shift_end', '<=', $request->date_to))
            ->when($request->user_id, fn($q) => $q->where('user_id', $request->user_id));

        return $this->paginated($query->latest()->paginate($request->per_page ?? 100));
    }

    /** PATCH /shift-end/{id}/approve — manager approves a shift end */
    public function approve(Request $request, ShiftEnd $shiftEnd): \Illuminate\Http\JsonResponse
    {
        $shiftEnd->update(['status' => 'approved', 'approved_by' => $request->user()->id]);
        return $this->success($shiftEnd->load('user', 'approvedBy'), 'Shift approved');
    }
}
