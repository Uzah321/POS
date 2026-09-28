<?php

namespace App\Support;

use App\Models\Expense;
use App\Models\Salary;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The money going out of the business that gets deducted from sales in every
 * report, the dashboard and End of Day — kept in one place so each screen
 * subtracts exactly the same figures for the same dates:
 *
 *  - expenses: approved expenses, by expense_date
 *  - salaries: gross salary (basic + allowances — PAYE/NSSA are still money the
 *    business pays out) of salaries marked paid, by paid_at; pending salaries
 *    don't count until they're actually paid
 *  - rent:     payments recorded against rentals the business pays (flow_type
 *    'expense'), by payment_date; rent the business collects isn't deducted
 *
 * Dates are inclusive 'Y-m-d' strings. Raw SUM()s come back from Postgres as
 * strings, so every figure is cast to float.
 */
class OperatingCosts
{
    /** @return array{expenses: float, salaries: float, rent: float, total: float} */
    public static function forPeriod(?int $branchId, string $from, string $to): array
    {
        $expenses = (float) Expense::where('status', 'approved')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween('expense_date', [$from, $to])
            ->sum('amount');

        $salaries = (float) Salary::where('status', 'paid')
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->whereBetween('paid_at', [$from, $to])
            ->sum('gross_salary');

        $rent = (float) self::rentPaidQuery($from, $to)
            ->when($branchId, fn($q) => $q->where('rentals.branch_id', $branchId))
            ->sum('rental_payments.amount');

        return self::shape($expenses, $salaries, $rent);
    }

    /**
     * Same figures as forPeriod(), one entry per branch, in three grouped
     * queries rather than three per branch.
     *
     * @return Collection<int, array{expenses: float, salaries: float, rent: float, total: float}>
     */
    public static function byBranch(string $from, string $to): Collection
    {
        $expenses = Expense::where('status', 'approved')
            ->whereBetween('expense_date', [$from, $to])
            ->groupBy('branch_id')
            ->selectRaw('branch_id, SUM(amount) as total')
            ->pluck('total', 'branch_id');

        $salaries = Salary::where('status', 'paid')
            ->whereBetween('paid_at', [$from, $to])
            ->groupBy('branch_id')
            ->selectRaw('branch_id, SUM(gross_salary) as total')
            ->pluck('total', 'branch_id');

        $rent = self::rentPaidQuery($from, $to)
            ->groupBy('rentals.branch_id')
            ->selectRaw('rentals.branch_id, SUM(rental_payments.amount) as total')
            ->pluck('total', 'branch_id');

        return $expenses->keys()->merge($salaries->keys())->merge($rent->keys())->unique()
            ->mapWithKeys(fn($branchId) => [$branchId => self::shape(
                (float) ($expenses[$branchId] ?? 0),
                (float) ($salaries[$branchId] ?? 0),
                (float) ($rent[$branchId] ?? 0),
            )]);
    }

    /** All-zero figures, for a branch with nothing recorded in the period. */
    public static function none(): array
    {
        return self::shape(0.0, 0.0, 0.0);
    }

    private static function rentPaidQuery(string $from, string $to)
    {
        return DB::table('rental_payments')
            ->join('rentals', 'rentals.id', '=', 'rental_payments.rental_id')
            ->where('rentals.flow_type', 'expense')
            ->whereBetween('rental_payments.payment_date', [$from, $to]);
    }

    private static function shape(float $expenses, float $salaries, float $rent): array
    {
        return [
            'expenses' => $expenses,
            'salaries' => $salaries,
            'rent'     => $rent,
            'total'    => $expenses + $salaries + $rent,
        ];
    }
}
