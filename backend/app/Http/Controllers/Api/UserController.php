<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class UserController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $query = User::with('roles', 'branch')
            ->when($request->search, fn($q) => $q->where('name', 'like', "%{$request->search}%")
                ->orWhere('email', 'like', "%{$request->search}%"))
            ->when($request->branch_id, fn($q) => $q->where('branch_id', $request->branch_id))
            ->when($request->role, fn($q) => $q->whereHas('roles', fn($r) => $r->where('name', $request->role)))
            ->when(isset($request->is_active), fn($q) => $q->where('is_active', $request->boolean('is_active')));

        return $this->paginated($query->orderBy('name')->paginate($request->per_page ?? 15));
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'      => 'required|string|max:255',
            'username'  => 'required|string|max:50|unique:users|alpha_dash',
            'email'     => 'nullable|email|unique:users',
            'phone'     => 'nullable|string|max:20',
            'password'  => 'required|string|min:8',
            'branch_id' => 'nullable|exists:branches,id',
            'roles'     => 'required|array',
            'roles.*'   => 'exists:roles,name',
        ]);

        $user = User::create([
            ...\Arr::except($data, ['roles', 'password']),
            'password' => Hash::make($data['password']),
        ]);

        $user->syncRoles($data['roles']);

        return $this->success($user->load('roles', 'branch'), 'User created successfully', 201);
    }

    public function show(User $user): \Illuminate\Http\JsonResponse
    {
        return $this->success($user->load('roles', 'branch'));
    }

    public function update(Request $request, User $user): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'      => 'sometimes|string|max:255',
            'username'  => "sometimes|string|max:50|alpha_dash|unique:users,username,{$user->id}",
            'email'     => "sometimes|nullable|email|unique:users,email,{$user->id}",
            'phone'     => 'nullable|string|max:20',
            'branch_id' => 'nullable|exists:branches,id',
            'is_active' => 'sometimes|boolean',
            'roles'     => 'sometimes|array',
            'roles.*'   => 'exists:roles,name',
            'password'  => 'sometimes|string|min:8',
        ]);

        if (isset($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        }

        $user->update(\Arr::except($data, ['roles']));

        if (isset($data['roles'])) {
            $user->syncRoles($data['roles']);
        }

        return $this->success($user->load('roles', 'branch'), 'User updated successfully');
    }

    public function destroy(User $user): \Illuminate\Http\JsonResponse
    {
        if ($user->id === auth()->id()) {
            return $this->error('You cannot delete your own account.', 403);
        }
        $user->delete();
        return $this->success(null, 'User deleted successfully');
    }
}
