<?php

namespace App\Http\Controllers\Api;

use App\Models\Customer;
use Illuminate\Http\Request;

class CustomerController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = Customer::when($request->search, function ($q) use ($request) {
                $s = '%' . mb_strtolower($request->search) . '%';
                $q->whereRaw('LOWER(name) LIKE ?', [$s])
                  ->orWhereRaw('LOWER(email) LIKE ?', [$s])
                  ->orWhereRaw('LOWER(phone) LIKE ?', [$s]);
            })
            ->when(isset($request->is_active), fn($q) => $q->where('is_active', $request->boolean('is_active')));

        return $this->paginated($query->orderBy('name')->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'         => 'required|string|max:255',
            'email'        => 'nullable|email|unique:customers',
            'phone'        => 'nullable|string|max:20',
            'address'      => 'nullable|string',
            'city'         => 'nullable|string',
            'id_number'    => 'nullable|string',
            'credit_limit' => 'nullable|numeric|min:0',
            'notes'        => 'nullable|string',
        ]);

        $customer = Customer::create($data);
        return $this->success($customer, 'Customer created', 201);
    }

    public function show(Customer $customer): \Illuminate\Http\JsonResponse
    {
        return $this->success($customer->load('sales', 'loyaltyTransactions', 'creditTransactions'));
    }

    public function update(Request $request, Customer $customer): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'         => 'sometimes|string|max:255',
            'email'        => "nullable|email|unique:customers,email,{$customer->id}",
            'phone'        => 'nullable|string|max:20',
            'address'      => 'nullable|string',
            'city'         => 'nullable|string',
            'id_number'    => 'nullable|string',
            'credit_limit' => 'nullable|numeric|min:0',
            'is_active'    => 'boolean',
            'notes'        => 'nullable|string',
        ]);

        $customer->update($data);
        return $this->success($customer, 'Customer updated');
    }

    public function destroy(Customer $customer): \Illuminate\Http\JsonResponse
    {
        $customer->delete();
        return $this->success(null, 'Customer deleted');
    }

    public function purchaseHistory(Customer $customer, Request $request): \Illuminate\Http\JsonResponse
    {
        $sales = $customer->sales()->with('items.product', 'payments')
            ->when($request->date_from, fn($q) => $q->whereDate('created_at', '>=', $request->date_from))
            ->when($request->date_to, fn($q) => $q->whereDate('created_at', '<=', $request->date_to))
            ->latest()->paginate(20);

        return $this->paginated($sales);
    }
}
