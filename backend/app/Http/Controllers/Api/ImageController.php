<?php

namespace App\Http\Controllers\Api;

use App\Models\Category;
use App\Models\Product;
use Symfony\Component\HttpFoundation\Response;

/**
 * Serves product/category pictures as real image files (see
 * ServesImageByUrl). Public on purpose: <img> tags can't send the API's
 * Bearer token, and catalogue pictures aren't sensitive. The `?v=` in the
 * link changes with the picture, so it can be cached for a year.
 */
class ImageController extends BaseApiController
{
    public function product(Product $product): Response
    {
        return $this->serve($product->getRawOriginal('image'));
    }

    public function category(Category $category): Response
    {
        return $this->serve($category->getRawOriginal('image'));
    }

    private function serve(?string $raw): Response
    {
        if (! $raw) {
            abort(404);
        }

        if (! str_starts_with($raw, 'data:')) {
            // Stored as a plain link rather than inline data.
            if (! preg_match('#^https?://#i', $raw)) {
                abort(404);
            }
            return redirect()->away($raw);
        }

        // Only ever answer with an image type — never let stored data be served as HTML/JS.
        if (! preg_match('#^data:(image/[\w.+-]+);base64,#', $raw, $m)) {
            abort(404);
        }

        $bytes = base64_decode(substr($raw, strlen($m[0])), true);
        if ($bytes === false) {
            abort(404);
        }

        return response($bytes, 200, [
            'Content-Type'            => $m[1],
            'Cache-Control'           => 'public, max-age=31536000, immutable',
            'X-Content-Type-Options'  => 'nosniff',
            // An SVG can carry script; opened directly it must not run any.
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'",
        ]);
    }
}
