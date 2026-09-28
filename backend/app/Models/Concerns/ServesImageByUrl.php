<?php

namespace App\Models\Concerns;

/**
 * Pictures are stored inline as base64 data URIs (up to ~1 MB each). Sending
 * them inside every product/category payload made the till's product list
 * ~10 MB for a few dozen products — and, since a category rides along with
 * each of its products, category pictures were repeated per product.
 *
 * So in every API response `image` is a link instead
 * (/api/{segment}/{id}/image?v={hash}, served by ImageController), which the
 * browser fetches once and caches; `v` changes whenever the picture does.
 * Screens keep doing <img src={x.image}> unchanged. getRawOriginal('image')
 * still returns the stored data.
 */
trait ServesImageByUrl
{
    /** URL segment the picture is served under, e.g. 'products'. */
    abstract protected function imageRouteSegment(): string;

    public function getImageAttribute($value): ?string
    {
        if (! $value || ! str_starts_with($value, 'data:')) {
            return $value; // no picture, or already a plain link
        }

        return url("/api/{$this->imageRouteSegment()}/{$this->getKey()}/image") . '?v=' . hash('crc32b', $value);
    }

    public function setImageAttribute($value): void
    {
        // Forms send back the `image` they were given, which is now one of our links.
        // Our own link means "picture unchanged"; another record's link (e.g. a new
        // product copying an existing one's picture) means "copy that picture".
        if (is_string($value) && preg_match('#/api/' . preg_quote($this->imageRouteSegment(), '#') . '/(\d+)/image#', $value, $m)) {
            if ($this->exists && (int) $m[1] === (int) $this->getKey()) {
                return;
            }
            $source = static::withoutGlobalScopes()->find((int) $m[1]);
            $value = $source?->getRawOriginal('image');
        }

        $this->attributes['image'] = $value;
    }
}
