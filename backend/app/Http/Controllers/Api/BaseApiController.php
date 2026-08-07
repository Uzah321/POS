<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

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

    /**
     * Resolve which business type (restaurant/supermarket) a request should be
     * scoped to, mirroring effectiveBranchId() above. Defaults to whichever
     * mode is currently active (the global `business_type` setting the
     * dashboard's "Switch to..." toggle writes), so every catalog/report
     * endpoint automatically follows the mode switch with no frontend
     * changes required. A caller may pass `business_type=all` (or any
     * explicit value) to opt out of — or override — that default, which the
     * admin-facing category management screen uses to see every category
     * regardless of the currently active mode.
     */
    protected function effectiveBusinessType(Request $request): ?string
    {
        if ($request->filled('business_type')) {
            $type = $request->string('business_type')->toString();
            return $type === 'all' ? null : $type;
        }

        return \App\Models\Setting::get('business_type') ?: null;
    }

    /**
     * Restricts a Sale query (or any query joined to `sales`) to the given
     * business type. A sale rung up before this column existed — or synced
     * from an older client — has a null business_type and is left visible in
     * every mode's reports/lists rather than silently vanishing from both.
     * Pass $table when the query joins `sales` under an alias/join rather
     * than being the base table itself, so the column reference isn't ambiguous.
     */
    protected function scopeSalesToBusinessType($query, ?string $businessType, ?string $table = null)
    {
        if (! $businessType) {
            return $query;
        }
        $column = $table ? "{$table}.business_type" : 'business_type';
        return $query->where(fn($q) => $q->where($column, $businessType)->orWhereNull($column));
    }

    /**
     * Restricts a Product query to the given business type. A product's own
     * `business_type` (stamped at creation from whichever mode was active)
     * is authoritative — this is what stops a restaurant-mode product with
     * no category assigned from leaking into the supermarket catalog, which
     * is exactly what happened when this only ever checked the category.
     * The category-based fallback only matters for the rare product whose
     * own tag is somehow still null (shouldn't happen for anything created
     * after this column existed, but is a safe default for it regardless).
     */
    protected function scopeProductsToBusinessType($query, ?string $businessType)
    {
        if (! $businessType) {
            return $query;
        }
        return $query->where(function ($q) use ($businessType) {
            $q->whereIn('products.business_type', [$businessType, 'both'])
              ->orWhere(function ($q2) use ($businessType) {
                  $q2->whereNull('products.business_type')
                     ->where(function ($q3) use ($businessType) {
                         $q3->whereHas('category', fn($c) => $c->whereIn('business_type', [$businessType, 'both']))
                            ->orWhereNull('products.category_id');
                     });
              });
        });
    }

    /**
     * Drop the cached dashboard payload (see ReportController::dashboard) for a
     * branch and for the "all branches" admin view, so the next request rebuilds
     * it instead of serving numbers from before whatever just changed. Call this
     * after any mutation the dashboard's headline stats depend on — a completed/
     * voided sale, a stock change, etc. — instead of waiting out the cache TTL.
     */
    protected function bustDashboardCache(?int $branchId): void
    {
        // Cache key is now 'dashboard:{branch}:{business_type}' — business_type
        // is a fixed, small set (not user input), so enumerating every
        // combination here is simpler and safer than trying to pattern-match
        // cache keys (which Laravel's cache stores don't support uniformly).
        foreach ([$branchId, null] as $branch) {
            foreach (['restaurant', 'supermarket', null] as $type) {
                Cache::forget('dashboard:' . ($branch ?: 'all') . ':' . ($type ?: 'all'));
            }
        }
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
