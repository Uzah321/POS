<?php

namespace App\Http\Controllers\Api;

use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\EndOfDay;
use Illuminate\Http\Request;

class ExpenseController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = Expense::with('category', 'user', 'branch')
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->category_id, fn($q) => $q->where('expense_category_id', $request->category_id))
            ->when($request->date_from, fn($q) => $q->whereDate('expense_date', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('expense_date', '<=', $request->date_to));

        return $this->paginated($query->latest()->paginate(20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'branch_id'           => 'required|exists:branches,id',
            'expense_category_id' => 'required|exists:expense_categories,id',
            'description'         => 'required|string',
            'amount'              => 'required|numeric|min:0.01',
            'expense_date'        => 'required|date',
            'notes'               => 'nullable|string',
        ]);

        $expense = Expense::create(array_merge($data, ['user_id' => $request->user()->id]));
        return $this->success($expense->load('category'), 'Expense recorded', 201);
    }

    public function update(Request $request, Expense $expense): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'expense_category_id' => 'sometimes|exists:expense_categories,id',
            'description'         => 'sometimes|string',
            'amount'              => 'sometimes|numeric|min:0.01',
            'expense_date'        => 'sometimes|date',
        ]);
        $expense->update($data);
        return $this->success($expense, 'Expense updated');
    }

    public function destroy(Expense $expense): \Illuminate\Http\JsonResponse
    {
        $expense->delete();
        return $this->success(null, 'Expense deleted');
    }

    public function categories(): \Illuminate\Http\JsonResponse
    {
        return $this->success(ExpenseCategory::where('is_active', true)->get());
    }
}
