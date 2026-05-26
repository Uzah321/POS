<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Foundation\Auth\Access\AuthorizesRequests;

abstract class BaseApiController extends Controller
{
    use AuthorizesRequests;

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
