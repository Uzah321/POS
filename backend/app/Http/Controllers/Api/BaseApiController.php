<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Http\Request;

abstract class BaseApiController extends Controller
{
    use AuthorizesRequests;

    /**
     * Resolve which branch a request should be scoped to. Branches now own
     * separate product catalogs/dashboards, so most roles are locked to their
     * own branch regardless of what they pass in — only 'admin' (the one role
     * with no branch-locked nav restrictions today) may view another branch,
     * or omit the filter entirely to see all branches combined.
     *
     * Returns null only for an admin who passed no branch_id (meaning "all
     * branches"); every other caller always gets a concrete branch id back.
     */
    protected function effectiveBranchId(Request $request): ?int
    {
        $user = $request->user();
        if ($user && $user->hasRole('admin')) {
            return $request->filled('branch_id') ? (int) $request->branch_id : null;
        }

        return $user?->branch_id;
    }

    protected function success(mixed $data = null, string $message = 'Success', int $code = 200): \Illuminate\Http\JsonResponse
    {
        return response()->json(['success' => true, 'message' => $message, 'data' => $data], $code);
    }

    protected function error(string $message = 'Error', int $code = 400, mixed $errors = null): \Illuminate\Http\JsonResponse
    {
        $payload = ['success' => false, 'message' => $message];
        if ($errors !== null) {
            $payload['errors'] = $errors;
        }
        return response()->json($payload, $code);
    }

    protected function paginated(mixed $data): \Illuminate\Http\JsonResponse
    {
        return response()->json(['success' => true, 'data' => $data]);
    }
}
