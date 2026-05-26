<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends BaseApiController
{
    public function login(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $user = User::where('username', $request->username)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'username' => ['The provided credentials are incorrect.'],
            ]);
        }

        if (! $user->is_active) {
            return $this->error('Your account has been disabled. Please contact the administrator.', 403);
        }

        $token = $user->createToken('api-token')->plainTextToken;

        AuditLog::create([
            'user_id' => $user->id,
            'event'   => 'login',
            'url'     => $request->url(),
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        $user->load('branch');
        $userData = $user->toArray();
        $userData['roles'] = $user->getRoleNames()->toArray();
        $userData['permissions'] = $user->getAllPermissions()->pluck('name')->toArray();

        return $this->success([
            'user'  => $userData,
            'token' => $token,
        ], 'Login successful');
    }

    public function logout(Request $request): \Illuminate\Http\JsonResponse
    {
        AuditLog::create([
            'user_id' => $request->user()->id,
            'event'   => 'logout',
            'url'     => $request->url(),
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        $request->user()->currentAccessToken()->delete();

        return $this->success(null, 'Logged out successfully');
    }

    public function me(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $request->user()->load('branch');
        $userData = $user->toArray();
        $userData['roles'] = $user->getRoleNames()->toArray();
        $userData['permissions'] = $user->getAllPermissions()->pluck('name')->toArray();
        return $this->success($userData);
    }

    public function updateProfile(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'name'         => 'sometimes|string|max:255',
            'phone'        => 'sometimes|nullable|string|max:20',
            'current_password' => 'required_with:new_password|string',
            'new_password' => 'sometimes|string|min:8|confirmed',
        ]);

        if (isset($data['new_password'])) {
            if (! Hash::check($data['current_password'], $user->password)) {
                return $this->error('Current password is incorrect.', 422);
            }
            $user->password = Hash::make($data['new_password']);
        }

        $user->fill(\Arr::only($data, ['name', 'phone']));
        $user->save();

        return $this->success($user, 'Profile updated successfully');
    }
}
