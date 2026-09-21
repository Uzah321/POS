<?php

namespace App\Http\Middleware;

use App\Services\License\LicenseService;
use Closure;
use Illuminate\Http\Request;

/**
 * Once a license has expired the install goes read-only: viewing and reports
 * still work, but anything that changes data (sales, stock, edits) is refused
 * until it's renewed. Sign-in and the license screen itself stay open.
 */
class EnforceLicense
{
    public function __construct(private LicenseService $license) {}

    public function handle(Request $request, Closure $next)
    {
        if ($request->isMethodSafe() || $request->is('api/auth/*', 'api/license/*')) {
            return $next($request);
        }

        if (! $this->license->allowsWrites()) {
            return response()->json([
                'success' => false,
                'code'    => 'LICENSE_EXPIRED',
                'message' => 'Your license has expired. Renew it to continue making sales and changes.',
            ], 402);
        }

        return $next($request);
    }
}
