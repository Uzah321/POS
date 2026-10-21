<?php

namespace App\Http\Controllers\Api;

use App\Models\Register;
use Illuminate\Http\Request;

class RegisterController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        return $this->success(
            Register::with('branch', 'fiscalDevice')
                ->when($request->branch_id, fn ($q) => $q->where('branch_id', $request->branch_id))
                ->get()
        );
    }

    /**
     * The branch's tills, for the till to say which one it is
     * (useSelectedRegister) — open to anyone who sells, unlike index(),
     * so names only. Anyone but an admin sees only their own branch's.
     */
    public function tills(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);

        return $this->success(
            Register::when($branchId, fn ($q) => $q->where('branch_id', $branchId))
                ->orderBy('name')
                ->get(['id', 'branch_id', 'name', 'code', 'is_active'])
        );
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:100',
            'code' => 'nullable|string|max:50',
            'branch_id' => 'required|exists:branches,id',
        ]);

        return $this->success(Register::create($data), 'Register created', 201);
    }

    public function show(Register $register): \Illuminate\Http\JsonResponse
    {
        return $this->success($register->load('branch', 'fiscalDevice.taxMappings'));
    }

    public function update(Request $request, Register $register): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name' => 'sometimes|string|max:100',
            'code' => 'nullable|string|max:50',
            'is_active' => 'boolean',
        ]);
        $register->update($data);

        return $this->success($register, 'Register updated');
    }

    public function destroy(Register $register): \Illuminate\Http\JsonResponse
    {
        $register->delete();

        return $this->success(null, 'Register deleted');
    }
}
