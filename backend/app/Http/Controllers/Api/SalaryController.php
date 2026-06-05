<?php

namespace App\Http\Controllers\Api;

use App\Models\Salary;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class SalaryController extends BaseApiController
{
    public function index(Request $request)
    {
        $query = Salary::with('branch:id,name', 'employee:id,name')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->pay_month, fn($q) => $q->where('pay_month', $request->pay_month))
            ->when($request->status, fn($q) => $q->where('status', $request->status))
            ->when($request->search, fn($q) => $q->where('employee_name', 'like', '%' . $request->search . '%'))
            ->latest('pay_month')->latest('id');

        if ($request->export === 'csv') {
            return $this->exportCsv($query->get(), $request->pay_month ?? 'all');
        }

        $all = (clone $query)->get();
        $summary = [
            'total_gross'      => $all->sum('gross_salary'),
            'total_deductions' => $all->sum('total_deductions'),
            'total_net'        => $all->sum('net_salary'),
            'total_paid'       => $all->where('status', 'paid')->sum('net_salary'),
            'total_pending'    => $all->where('status', 'pending')->sum('net_salary'),
            'employee_count'   => $all->unique('employee_name')->count(),
        ];

        return $this->success([
            'salaries' => $query->paginate($request->per_page ?? 50),
            'summary'  => $summary,
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'branch_id'           => 'required|exists:branches,id',
            'employee_id'         => 'nullable|exists:users,id',
            'employee_name'       => 'required|string|max:255',
            'position'            => 'nullable|string|max:100',
            'pay_month'           => 'required|string|regex:/^\d{4}-\d{2}$/',
            'basic_salary'        => 'required|numeric|min:0',
            'housing_allowance'   => 'nullable|numeric|min:0',
            'transport_allowance' => 'nullable|numeric|min:0',
            'other_allowances'    => 'nullable|numeric|min:0',
            'paye'                => 'nullable|numeric|min:0',
            'nssa'                => 'nullable|numeric|min:0',
            'other_deductions'    => 'nullable|numeric|min:0',
            'notes'               => 'nullable|string',
        ]);

        $basic    = $data['basic_salary'];
        $housing  = $data['housing_allowance'] ?? 0;
        $transport= $data['transport_allowance'] ?? 0;
        $other    = $data['other_allowances'] ?? 0;
        $paye     = $data['paye'] ?? 0;
        $nssa     = $data['nssa'] ?? 0;
        $otherDed = $data['other_deductions'] ?? 0;

        $gross      = $basic + $housing + $transport + $other;
        $totalDed   = $paye + $nssa + $otherDed;
        $net        = $gross - $totalDed;

        $salary = Salary::create([
            'reference'           => 'SAL-' . strtoupper(Str::random(8)),
            'branch_id'           => $data['branch_id'],
            'created_by'          => auth()->id(),
            'employee_id'         => $data['employee_id'] ?? null,
            'employee_name'       => $data['employee_name'],
            'position'            => $data['position'] ?? null,
            'pay_month'           => $data['pay_month'],
            'basic_salary'        => $basic,
            'housing_allowance'   => $housing,
            'transport_allowance' => $transport,
            'other_allowances'    => $other,
            'gross_salary'        => $gross,
            'paye'                => $paye,
            'nssa'                => $nssa,
            'other_deductions'    => $otherDed,
            'total_deductions'    => $totalDed,
            'net_salary'          => $net,
            'notes'               => $data['notes'] ?? null,
        ]);

        return $this->success($salary->load('branch:id,name', 'employee:id,name'), 'Salary record created', 201);
    }

    public function update(Request $request, Salary $salary)
    {
        $data = $request->validate([
            'employee_name'       => 'sometimes|string|max:255',
            'position'            => 'nullable|string|max:100',
            'basic_salary'        => 'sometimes|numeric|min:0',
            'housing_allowance'   => 'nullable|numeric|min:0',
            'transport_allowance' => 'nullable|numeric|min:0',
            'other_allowances'    => 'nullable|numeric|min:0',
            'paye'                => 'nullable|numeric|min:0',
            'nssa'                => 'nullable|numeric|min:0',
            'other_deductions'    => 'nullable|numeric|min:0',
            'notes'               => 'nullable|string',
        ]);

        $basic    = $data['basic_salary']        ?? $salary->basic_salary;
        $housing  = $data['housing_allowance']   ?? $salary->housing_allowance;
        $transport= $data['transport_allowance'] ?? $salary->transport_allowance;
        $other    = $data['other_allowances']    ?? $salary->other_allowances;
        $paye     = $data['paye']               ?? $salary->paye;
        $nssa     = $data['nssa']               ?? $salary->nssa;
        $otherDed = $data['other_deductions']   ?? $salary->other_deductions;

        $gross    = $basic + $housing + $transport + $other;
        $totalDed = $paye + $nssa + $otherDed;

        $salary->update(array_merge($data, [
            'gross_salary'    => $gross,
            'total_deductions'=> $totalDed,
            'net_salary'      => $gross - $totalDed,
        ]));

        return $this->success($salary->fresh()->load('branch:id,name'), 'Salary updated');
    }

    public function markPaid(Request $request, Salary $salary)
    {
        $data = $request->validate([
            'payment_method' => 'required|string',
            'paid_at'        => 'required|date',
        ]);

        $salary->update([
            'status'         => 'paid',
            'payment_method' => $data['payment_method'],
            'paid_at'        => $data['paid_at'],
        ]);

        return $this->success($salary, 'Marked as paid');
    }

    public function destroy(Salary $salary)
    {
        $salary->delete();
        return $this->success(null, 'Record deleted');
    }

    private function exportCsv($salaries, $month)
    {
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"salaries-{$month}.csv\"",
            'Cache-Control'       => 'no-cache',
        ];

        $callback = function () use ($salaries, $month) {
            $f = fopen('php://output', 'w');
            fputcsv($f, ["SALARY PAYROLL - {$month}"]);
            fputcsv($f, []);
            fputcsv($f, [
                'Reference', 'Employee', 'Position', 'Branch', 'Month',
                'Basic Salary', 'Housing Allow.', 'Transport Allow.', 'Other Allow.',
                'Gross Salary', 'PAYE', 'NSSA', 'Other Deductions', 'Total Deductions',
                'Net Salary', 'Status', 'Paid Date', 'Payment Method',
            ]);
            foreach ($salaries as $s) {
                fputcsv($f, [
                    $s->reference, $s->employee_name, $s->position ?? '',
                    $s->branch?->name ?? '', $s->pay_month,
                    $s->basic_salary, $s->housing_allowance, $s->transport_allowance,
                    $s->other_allowances, $s->gross_salary,
                    $s->paye, $s->nssa, $s->other_deductions, $s->total_deductions,
                    $s->net_salary, $s->status,
                    $s->paid_at?->format('Y-m-d') ?? '',
                    $s->payment_method ?? '',
                ]);
            }
            // Totals row
            fputcsv($f, []);
            fputcsv($f, [
                'TOTALS', '', '', '', '',
                $salaries->sum('basic_salary'), $salaries->sum('housing_allowance'),
                $salaries->sum('transport_allowance'), $salaries->sum('other_allowances'),
                $salaries->sum('gross_salary'), $salaries->sum('paye'), $salaries->sum('nssa'),
                $salaries->sum('other_deductions'), $salaries->sum('total_deductions'),
                $salaries->sum('net_salary'),
            ]);
            fclose($f);
        };

        return response()->stream($callback, 200, $headers);
    }
}
