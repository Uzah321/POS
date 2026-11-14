<?php

namespace App\Support;

/**
 * How a product search box matches (the web tills and the Android app match
 * their loaded lists the same way — productSearch.ts, models.dart):
 *
 *  - every word typed appears in the product NAME, in any order — "chicken
 *    burger" finds "Burger - Chicken";
 *  - a number must be a whole number in the name, so a size finds that size:
 *    "blouse 32" finds "MINDA BLOUSE 32" but not "BLOUSE 132", nor a product
 *    whose SKU or barcode merely contains the digits 32;
 *  - or the whole search is the product's SKU or barcode (or, from 4
 *    characters, the start of one), for typed or scanned codes.
 *
 * A PLU code or scale label is matched separately (ScaleBarcode::orWherePlu).
 */
class ProductSearch
{
    /** Adds the match as one nested condition on `$query` (a product query). */
    public static function apply($query, string $term): void
    {
        $code = mb_strtolower(trim($term));
        $words = preg_split('/\s+/u', $code, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if ($words === []) {
            $query->whereRaw('1 = 1'); // nothing typed: everything matches
            return;
        }

        $query->where(function ($q) use ($words, $code) {
            $q->where(function ($q) use ($words) {
                foreach ($words as $word) {
                    self::whereNameHas($q, $word);
                }
            })
              ->orWhereRaw('LOWER(sku) = ?', [$code])
              ->orWhereRaw('LOWER(barcode) = ?', [$code]);
            if (mb_strlen($code) >= 4) {
                $q->orWhereRaw('LOWER(sku) LIKE ?', [$code . '%'])
                  ->orWhereRaw('LOWER(barcode) LIKE ?', [$code . '%']);
            }
        });
    }

    /** The name contains the word — a number only as a whole number (not inside a longer one). */
    private static function whereNameHas($q, string $word): void
    {
        if (! ctype_digit($word)) {
            $q->whereRaw('LOWER(name) LIKE ?', ['%' . $word . '%']);
            return;
        }

        $regex = '(^|[^0-9])' . $word . '([^0-9]|$)';
        switch ($q->getConnection()->getDriverName()) {
            case 'pgsql':
                $q->whereRaw('LOWER(name) ~ ?', [$regex]);
                break;
            case 'mysql':
            case 'mariadb':
                $q->whereRaw('LOWER(name) REGEXP ?', [$regex]);
                break;
            case 'sqlite':
                $q->where(function ($q) use ($word) {
                    $q->whereRaw('LOWER(name) GLOB ?', [$word])
                      ->orWhereRaw('LOWER(name) GLOB ?', [$word . '[^0-9]*'])
                      ->orWhereRaw('LOWER(name) GLOB ?', ['*[^0-9]' . $word])
                      ->orWhereRaw('LOWER(name) GLOB ?', ['*[^0-9]' . $word . '[^0-9]*']);
                });
                break;
            default:
                $q->whereRaw('LOWER(name) LIKE ?', ['%' . $word . '%']);
        }
    }
}
