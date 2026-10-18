<?php

namespace App\Support;

use App\Models\Setting;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * PLU codes in product searches. A label printed by the counter scale carries
 * the item's PLU code plus its weight or price, laid out as set in Settings →
 * Barcodes — so a label scanned into a search box finds its product by that
 * PLU code, the same as typing the PLU code itself. Mirrors the till's
 * decoder (frontend lib/barcode/embeddedBarcode.ts), including what a field
 * left blank in Settings means.
 */
class ScaleBarcode
{
    /** Blank Settings → Barcodes fields mean these — the placeholders shown there. */
    private const DEFAULTS = [
        'barcode_weight' => ['prefix' => '20', 'code_position' => 4, 'code_length' => 3, 'value_position' => 8, 'value_length' => 5],
        'barcode_price'  => ['prefix' => '2',  'code_position' => 4, 'code_length' => 4, 'value_position' => 9, 'value_length' => 4],
    ];

    /** The weight/price field's own key in each layout. */
    private const VALUE_FIELD = ['barcode_weight' => 'qty', 'barcode_price' => 'value'];

    /**
     * Adds "or it's the product this search names by PLU code" to a products
     * query's search group: any product whose PLU Code is the search text,
     * and for a scale label, the product with the label's PLU code (or that
     * code as its SKU, where a shop coming from another till kept it).
     * Leading zeros don't matter.
     */
    public static function orWherePlu(Builder|QueryBuilder $query, string $term): void
    {
        $term = trim($term);
        if (! preg_match('/^\d+$/', $term)) {
            return;
        }
        $query->orWhereIn('plu_code', self::spellings(self::normalize($term)));

        $labelPlu = self::pluFromLabel($term);
        if ($labelPlu !== null) {
            $spellings = self::spellings($labelPlu);
            $query->orWhereIn('plu_code', $spellings)->orWhereIn('sku', $spellings);
        }
    }

    /** The PLU code inside a scale label (leading zeros dropped), or null when `$code` isn't one. */
    public static function pluFromLabel(string $code): ?string
    {
        $code = trim($code);
        if (! preg_match('/^\d+$/', $code)) {
            return null;
        }
        $keys = [];
        foreach (self::DEFAULTS as $kind => $defaults) {
            foreach (['enabled', 'prefix', 'code_position', 'code_length', self::VALUE_FIELD[$kind] . '_position', self::VALUE_FIELD[$kind] . '_length'] as $field) {
                $keys[] = "{$kind}_{$field}";
            }
        }
        $settings = Setting::whereIn('key', $keys)->pluck('value', 'key');

        // Weight first, as the till tries them.
        foreach (array_keys(self::DEFAULTS) as $kind) {
            $plu = self::decode($code, $kind, $settings->all());
            if ($plu !== null) {
                return $plu;
            }
        }
        return null;
    }

    private static function decode(string $code, string $kind, array $settings): ?string
    {
        if (! filter_var($settings["{$kind}_enabled"] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return null;
        }
        $defaults = self::DEFAULTS[$kind];
        $value = self::VALUE_FIELD[$kind];
        $field = function (string $name, $default) use ($settings, $kind) {
            $raw = trim((string) ($settings["{$kind}_{$name}"] ?? ''));
            return $raw === '' ? $default : $raw;
        };

        $prefix = (string) $field('prefix', $defaults['prefix']);
        if (! str_starts_with($code, $prefix)) {
            return null;
        }
        $plu = self::slice($code, (int) $field('code_position', $defaults['code_position']), (int) $field('code_length', $defaults['code_length']));
        $amount = self::slice($code, (int) $field("{$value}_position", $defaults['value_position']), (int) $field("{$value}_length", $defaults['value_length']));
        if ($plu === null || $amount === null || (int) $amount <= 0) {
            return null;
        }
        return self::normalize($plu);
    }

    /** `$length` digits from 1-indexed `$position`, or null when they run past the end. */
    private static function slice(string $code, int $position, int $length): ?string
    {
        if ($position < 1 || $length < 1 || $position - 1 + $length > strlen($code)) {
            return null;
        }
        return substr($code, $position - 1, $length);
    }

    private static function normalize(string $code): string
    {
        return ltrim($code, '0') === '' ? '0' : ltrim($code, '0');
    }

    /**
     * A PLU code as it might have been typed on the product — "123", "0123",
     * "00123", ... up to a full barcode's 13 digits — so matching it is a plain
     * IN (...) on every database, not a leading-zero trim in SQL.
     */
    private static function spellings(string $code): array
    {
        $spellings = [];
        for ($length = strlen($code); $length <= max(strlen($code), 13); $length++) {
            $spellings[] = str_pad($code, $length, '0', STR_PAD_LEFT);
        }
        return $spellings;
    }
}
