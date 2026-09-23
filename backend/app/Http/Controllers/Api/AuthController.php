<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

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

        // Cookie/session auth for the browser SPA. Bearer token above is kept
        // for non-browser API clients (e.g. smoke_test.js); the SPA ignores it.
        // Only stateful (same-site browser) requests get a session on them at all.
        if ($request->hasSession()) {
            Auth::login($user);
            $request->session()->regenerate();
        }

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

        $this->invalidateCurrentAuth($request);

        return $this->success(null, 'Logged out successfully');
    }

    // Session-authenticated requests get a TransientToken (no delete()), while
    // Bearer-token requests (smoke_test.js, other API clients) get a real
    // PersonalAccessToken row that must be revoked explicitly.
    private function invalidateCurrentAuth(Request $request): void
    {
        $token = $request->user()->currentAccessToken();
        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        }

        if ($request->hasSession()) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
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
            'new_password' => ['sometimes', 'confirmed', Password::min(8)->mixedCase()->numbers()],
        ]);

        $changedOwnPassword = isset($data['new_password']);
        if ($changedOwnPassword) {
            if (! Hash::check($data['current_password'], $user->password)) {
                return $this->error('Current password is incorrect.', 422);
            }
            $user->password = Hash::make($data['new_password']);
        }

        $user->fill(\Arr::only($data, ['name', 'phone']));
        $user->save();

        // Changing your own password should kick out any other device/browser
        // still signed in as you. Re-establish the current session afterwards
        // so the user isn't logged out of the tab they just made the change from.
        if ($changedOwnPassword) {
            $user->revokeAllSessions();
            if ($request->hasSession()) {
                Auth::login($user);
                $request->session()->regenerate();
            }
        }

        return $this->success($user, 'Profile updated successfully');
    }

    public function pinLogin(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['pin' => 'required|string|size:4']);
        $user = User::where('pin', $data['pin'])->first();
        if (!$user || !$user->is_active) return $this->error('Invalid PIN', 401);
        return $this->success(['user' => $user]);
    }

    public function setPin(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['pin' => 'required|string|size:4|regex:/^[0-9]+$/']);
        $request->user()->update(['pin' => $data['pin']]);
        return $this->success(null, 'PIN updated');
    }
}
