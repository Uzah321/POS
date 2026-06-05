<?php

namespace App\Http\Controllers\Api;

use App\Models\Rental;
use App\Models\RentalPayment;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class RentalController extends BaseApiController
{
    public function index(Request $request)
    {
        $query = Rental::with('branch:id,name', 'payments')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->flow_type, fn($q) => $q->where('flow_type', $request->flow_type))
            ->when($request->status, fn($q) => $q->where('status', $request->status))
            ->when($request->search, fn($q) => $q->where(function ($sq) use ($request) {
                $sq->where('property_name', 'like', '%' . $request->search . '%')
                   ->orWhere('tenant_name', 'like', '%' . $request->search . '%');
            }))
            ->latest();

        if ($request->export === 'csv') {
            return $this->exportCsv($query->get());
        }

        $rentals = $query->paginate($request->per_page ?? 30);

        // Summary
        $all = Rental::with('payments')->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))->where('status', 'active')->get();
        $summary = [
            'total_income_monthly'  => $all->where('flow_type', 'income')->sum('monthly_amount'),
            'total_expense_monthly' => $all->where('flow_type', 'expense')->sum('monthly_amount'),
            'active_count'          => $all->count(),
        ];

        return $this->success(compact('rentals', 'summary'));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'branch_id'     => 'required|exists:branches,id',
            'property_name' => 'required|string|max:255',
            'property_type' => 'nullable|in:commercial,residential,storage',
            'tenant_name'   => 'required|string|max:255',
            'tenant_phone'  => 'nullable|string|max:20',
            'tenant_email'  => 'nullable|email|max:255',
            'monthly_amount'=> 'required|numeric|min:0.01',
            'currency'      => 'nullable|string|max:10',
            'lease_start'   => 'required|date',
            'lease_end'     => 'nullable|date|after:lease_start',
            'flow_type'     => 'required|in:income,expense',
            'status'        => 'nullable|in:active,expired,terminated',
            'notes'         => 'nullable|string',
        ]);

        $rental = Rental::create(array_merge($data, [
            'created_by' => auth()->id(),
            'currency'   => $data['currency'] ?? 'USD',
            'status'     => $data['status'] ?? 'active',
        ]));

        return $this->success($rental->load('branch:id,name'), 'Rental created', 201);
    }

    public function update(Request $request, Rental $rental)
    {
        $data = $request->validate([
            'property_name' => 'sometimes|string|max:255',
            'property_type' => 'nullable|in:commercial,residential,storage',
            'tenant_name'   => 'sometimes|string|max:255',
            'tenant_phone'  => 'nullable|string|max:20',
            'tenant_email'  => 'nullable|email|max:255',
            'monthly_amount'=> 'sometimes|numeric|min:0.01',
            'currency'      => 'nullable|string|max:10',
            'lease_start'   => 'sometimes|date',
            'lease_end'     => 'nullable|date',
            'flow_type'     => 'sometimes|in:income,expense',
            'status'        => 'sometimes|in:active,expired,terminated',
            'notes'         => 'nullable|string',
        ]);

        $rental->update($data);
        return $this->success($rental->fresh()->load('branch:id,name', 'payments'), 'Rental updated');
    }

    public function destroy(Rental $rental)
    {
        $rental->delete();
        return $this->success(null, 'Rental deleted');
    }

    public function addPayment(Request $request, Rental $rental)
    {
        $data = $request->validate([
            'period'         => 'required|string|regex:/^\d{4}-\d{2}$/',
            'amount'         => 'required|numeric|min:0.01',
            'payment_date'   => 'required|date',
            'payment_method' => 'nullable|string|max:50',
            'notes'          => 'nullable|string',
        ]);

        // Prevent duplicate payment for same period
        if ($rental->payments()->where('period', $data['period'])->exists()) {
            return $this->error("Payment for {$data['period']} already recorded", 422);
        }

        $payment = RentalPayment::create([
            'reference'      => 'RNT-' . strtoupper(Str::random(8)),
            'rental_id'      => $rental->id,
            'recorded_by'    => auth()->id(),
            'period'         => $data['period'],
            'amount'         => $data['amount'],
            'payment_date'   => $data['payment_date'],
            'payment_method' => $data['payment_method'] ?? 'cash',
            'notes'          => $data['notes'] ?? null,
        ]);

        return $this->success($payment, 'Payment recorded', 201);
    }

    public function payments(Request $request, Rental $rental)
    {
        $payments = $rental->payments()->with('recordedBy:id,name')->latest('payment_date')->paginate(20);
        return $this->success($payments);
    }

    private function exportCsv($rentals)
    {
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="rentals.csv"',
            'Cache-Control'       => 'no-cache',
        ];

        $callback = function () use ($rentals) {
            $f = fopen('php://output', 'w');
            fputcsv($f, ['Property', 'Type', 'Tenant', 'Phone', 'Monthly Amount', 'Currency', 'Flow Type', 'Lease Start', 'Lease End', 'Status', 'Total Paid', 'Branch']);
            foreach ($rentals as $r) {
                fputcsv($f, [
                    $r->property_name, $r->property_type, $r->tenant_name, $r->tenant_phone ?? '',
                    $r->monthly_amount, $r->currency, $r->flow_type,
                    $r->lease_start?->format('Y-m-d'), $r->lease_end?->format('Y-m-d') ?? '',
                    $r->status, $r->payments->sum('amount'),
                    $r->branch?->name ?? '',
                ]);
            }
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }
}
