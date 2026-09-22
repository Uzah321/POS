<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class UserController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);
        $query = User::with('roles', 'branch', 'department')
            ->when($request->search, function ($q) use ($request) {
                $s = '%' . mb_strtolower($request->search) . '%';
                $q->whereRaw('LOWER(name) LIKE ?', [$s])
                  ->orWhereRaw('LOWER(email) LIKE ?', [$s]);
            })
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
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
            'password'      => 'required|string|min:4',
            'branch_id'     => 'nullable|exists:branches,id',
            'department_id' => 'nullable|exists:departments,id',
            // Which shop this person works in. Empty = follows the system-wide mode.
            'business_type' => 'nullable|in:restaurant,supermarket',
            'roles'     => 'required|array',
            'roles.*'   => 'exists:roles,name',
        ]);

        // Staff belong to exactly one branch, same as products/categories —
        // only an admin may place a new hire in a branch other than their own.
        $caller = $request->user();
        $data['branch_id'] = ($caller->hasRole('admin') && $request->filled('branch_id'))
            ? (int) $request->branch_id
            : $caller->branch_id;

        $user = User::create([
            ...\Arr::except($data, ['roles', 'password']),
            'password' => Hash::make($data['password']),
        ]);

        $user->syncRoles($data['roles']);

        return $this->success($user->load('roles', 'branch', 'department'), 'User created successfully', 201);
    }

    public function show(User $user): \Illuminate\Http\JsonResponse
    {
        return $this->success($user->load('roles', 'branch', 'department'));
    }

    public function update(Request $request, User $user): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'name'          => 'sometimes|string|max:255',
            'username'      => "sometimes|string|max:50|alpha_dash|unique:users,username,{$user->id}",
            'email'         => "sometimes|nullable|email|unique:users,email,{$user->id}",
            'phone'         => 'nullable|string|max:20',
            'branch_id'     => 'nullable|exists:branches,id',
            'department_id' => 'nullable|exists:departments,id',
            'business_type' => 'nullable|in:restaurant,supermarket',
            'is_active' => 'sometimes|boolean',
            'roles'     => 'sometimes|array',
            'roles.*'   => 'exists:roles,name',
            'password'  => 'sometimes|string|min:4',
        ]);

        if (isset($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        }

        // Only an admin may move a staff member to a different branch.
        if (! $request->user()->hasRole('admin')) {
            unset($data['branch_id']);
        }

        $user->update(\Arr::except($data, ['roles']));

        if (isset($data['roles'])) {
            $user->syncRoles($data['roles']);
        }

        return $this->success($user->load('roles', 'branch', 'department'), 'User updated successfully');
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
