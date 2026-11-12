<?php

namespace App\Support;

/**
 * How a product search box matches: every word typed appears somewhere in the
 * product's name, SKU or barcode, in any order — "chicken burger" finds
 * "Burger - Chicken", "coke 500" finds "Coke Zero 500ml". The web tills and
 * the Android app match their loaded lists the same way (productSearch.ts,
 * models.dart). A PLU code or scale label is matched separately (ScaleBarcode).
 */
class ProductSearch
{
    /** Adds the condition to `$query` (a product query, or a nested where on one). */
    public static function whereEveryWordMatches($query, string $term): void
    {
        $words = preg_split('/\s+/u', mb_strtolower(trim($term)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if ($words === []) {
            $query->whereRaw('1 = 1'); // nothing typed: everything matches
            return;
        }
        foreach ($words as $word) {
            $like = '%' . $word . '%';
            $query->where(function ($q) use ($like) {
                $q->whereRaw('LOWER(name) LIKE ?', [$like])
                  ->orWhereRaw('LOWER(sku) LIKE ?', [$like])
                  ->orWhereRaw('LOWER(barcode) LIKE ?', [$like]);
            });
        }
    }
}
