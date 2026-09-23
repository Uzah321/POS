<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Spatie\Permission\Middleware\PermissionMiddleware;
use Spatie\Permission\Middleware\RoleMiddleware;
use Spatie\Permission\Middleware\RoleOrPermissionMiddleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Lets the browser SPA authenticate via an httpOnly session cookie
        // instead of a Bearer token in localStorage. Non-browser API clients
        // (smoke_test.js, etc.) are unaffected — they keep using Bearer tokens.
        $middleware->api(prepend: [
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
        ]);

        // These routes are deliberately public/loginless (KDS kitchen screens,
        // the vendor license check-in, currency list, desktop shortcut) and are
        // sometimes called from a browser tab without any CSRF priming. Once a
        // request is "stateful" (see above), Laravel would otherwise 419 them.
        $middleware->validateCsrfTokens(except: [
            'api/kds/*',
            'api/network-info',
            'api/license/check',
            'api/currencies',
            'api/download/core-shortcut.url',
        ]);

        $middleware->alias([
            'role' => RoleMiddleware::class,
            'permission' => PermissionMiddleware::class,
            'role_or_permission' => RoleOrPermissionMiddleware::class,
            'license' => \App\Http\Middleware\EnforceLicense::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // API routes must get JSON errors, never HTML redirects
        $exceptions->render(function (\Illuminate\Auth\AuthenticationException $e, $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json(['success' => false, 'message' => 'Unauthenticated.'], 401);
            }
        });
        $exceptions->render(function (\Illuminate\Auth\Access\AuthorizationException $e, $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json(['success' => false, 'message' => 'Forbidden.'], 403);
            }
        });
        $exceptions->render(function (\Illuminate\Validation\ValidationException $e, $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json(['success' => false, 'message' => 'Validation failed.', 'errors' => $e->errors()], 422);
            }
        });
        // Catch-all: any unhandled exception on an API route returns JSON, never an HTML 500 page.
        // 4xx statuses come from deliberate abort(4xx, '...') calls elsewhere in the app (business
        // rule messages like "Nothing left to refund") — those are safe and meant to reach the
        // user, so always show them. Only genuine 5xx failures get the generic message hidden
        // behind APP_DEBUG, since those can leak internals (SQL, file paths, stack traces).
        $exceptions->render(function (\Throwable $e, $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                $status  = method_exists($e, 'getStatusCode') ? $e->getStatusCode() : 500;
                $message = ($status < 500 || config('app.debug')) ? $e->getMessage() : 'Server error.';
                return response()->json(['success' => false, 'message' => $message], $status);
            }
        });
    })->create();
