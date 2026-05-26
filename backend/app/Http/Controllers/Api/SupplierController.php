<?php

namespace App\Http\Controllers\Api;

use App\Models\Supplier;
use Illuminate\Http\Request;

class SupplierController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = Supplier::when($request->search, fn($q) => $q->where(function ($q) use ($request) {
                $q->where('name', 'like', "%{$request->search}%")
                  ->orWhere('email', 'like', "%{$request->search}%")
                  ->orWhere('phone', 'like', "%{$request->search}%");
            }));

        return $this->paginated($query->orderBy('name')->paginate($request->per_page ?? 20));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'           => 'required|string|max:255',
            'company_name'   => 'nullable|string',
            'email'          => 'nullable|email',
            'phone'          => 'nullable|string|max:20',
            'address'        => 'nullable|string',
            'city'           => 'nullable|string',
            'country'        => 'nullable|string',
            'vat_number'     => 'nullable|string',
            'account_number' => 'nullable|string',
            'credit_limit'   => 'nullable|numeric|min:0',
            'notes'          => 'nullable|string',
        ]);

        $supplier = Supplier::create($data);
        return $this->success($supplier, 'Supplier created', 201);
    }

    public function show(Supplier $supplier): \Illuminate\Http\JsonResponse
    {
        return $this->success($supplier->load('purchaseOrders', 'payments'));
    }

    public function update(Request $request, Supplier $supplier): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'           => 'sometimes|string|max:255',
            'company_name'   => 'nullable|string',
            'email'          => 'nullable|email',
            'phone'          => 'nullable|string|max:20',
            'address'        => 'nullable|string',
            'city'           => 'nullable|string',
            'country'        => 'nullable|string',
            'vat_number'     => 'nullable|string',
            'account_number' => 'nullable|string',
            'credit_limit'   => 'nullable|numeric|min:0',
            'is_active'      => 'boolean',
            'notes'          => 'nullable|string',
        ]);

        $supplier->update($data);
        return $this->success($supplier, 'Supplier updated');
    }

    public function destroy(Supplier $supplier): \Illuminate\Http\JsonResponse
    {
        $supplier->delete();
        return $this->success(null, 'Supplier deleted');
    }
}
