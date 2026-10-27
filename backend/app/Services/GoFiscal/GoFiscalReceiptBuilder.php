<?php

namespace App\Services\GoFiscal;

use App\Models\GoFiscalReceipt;
use App\Models\Product;
use App\Models\Refund;
use App\Models\Sale;
use App\Models\Setting;
use Illuminate\Support\Collection;

/**
 * Turns a sale into a GoFiscal FiscalInvoice, and a refund into a CreditNote.
 * Only what the engine can't work out itself goes in — no receipt numbers,
 * signatures, tax amounts or totals: it looks up each line's tax by code,
 * totals the lines, numbers and signs the receipt.
 *
 * Every line has price × quantity = total; discounts go on Discount lines,
 * one per tax code, so the lines still add up to what the customer paid.
 *
 * $taxes is the device's tax list (GoFiscalService::taxes): where it has more
 * than one tax on a code, the line says which by its taxID.
 */
class GoFiscalReceiptBuilder
{
    public function forSale(Sale $sale, array $taxes = []): array
    {
        $sale->loadMissing('items.product.taxRate', 'payments', 'branch');
        $hsDefault = $this->defaultHsCode();
        $taxEnabled = filter_var(Setting::get('tax_enabled', false), FILTER_VALIDATE_BOOLEAN);
        $globalRate = (float) Setting::get('tax_rate', 0);
        $date = ($sale->created_at ?? now())->toDateString();

        $lines = [];
        $discounts = [];   // tax code => amount
        $groupTotals = []; // tax code => what its lines come to after their own discounts
        $groupHs = [];     // tax code => an HS code for its Discount line
        $groupTax = [];    // tax code => the taxID its Discount line goes under
        foreach ($sale->items as $item) {
            $product = $item->product;
            [$code, $percent] = $this->tax($product, $taxEnabled, $globalRate);
            $taxId = $this->taxId($taxes, $code, $percent, $date);
            $line = $this->line(count($lines) + 1, 'Sale', $product?->name ?? 'Item', (float) $item->unit_price, (float) $item->quantity, $product?->hs_code ?: $hsDefault, $code, $taxId);
            $lines[] = $line;

            $discount = round($line['receiptLineTotal'] - (float) $item->total, 2);
            if ($discount > 0) {
                $discounts[$code] = ($discounts[$code] ?? 0) + $discount;
            }
            $groupTotals[$code] = ($groupTotals[$code] ?? 0) + (float) $item->total;
            $groupHs[$code] ??= $line['receiptLineHSCode'] ?? null;
            $groupTax[$code] ??= $taxId;
        }

        // A discount on the whole sale is shared between the tax codes in
        // proportion to what each one's lines come to.
        $cartDiscount = round((float) $sale->discount_amount - (float) $sale->items->sum('discount_amount'), 2);
        $base = array_sum($groupTotals);
        if ($cartDiscount > 0 && $base > 0) {
            $codes = array_keys($groupTotals);
            $left = $cartDiscount;
            foreach ($codes as $i => $code) {
                $share = $i === count($codes) - 1 ? $left : round($cartDiscount * $groupTotals[$code] / $base, 2);
                $left = round($left - $share, 2);
                $discounts[$code] = ($discounts[$code] ?? 0) + $share;
            }
        }

        foreach ($discounts as $code => $amount) {
            if (round($amount, 2) > 0) {
                $lines[] = $this->line(count($lines) + 1, 'Discount', 'Discount', -round($amount, 2), 1, $groupHs[$code] ?? $hsDefault, $code, $groupTax[$code] ?? null);
            }
        }

        $total = $this->total($lines);

        return [
            'receiptType' => 'FiscalInvoice',
            'receiptCurrency' => $this->currency($sale),
            'invoiceNo' => $sale->reference,
            'receiptLinesTaxInclusive' => true,
            'receiptLines' => $lines,
            'receiptPayments' => $this->payments($sale->payments, $total),
        ];
    }

    /**
     * A credit note against $original (which the engine has already numbered)
     * — the same lines, negative. A refund of a discounted line gives back
     * less than price × quantity; the difference goes back on a Discount line.
     */
    public function forRefund(Refund $refund, GoFiscalReceipt $original, array $taxes = []): array
    {
        $refund->loadMissing('items.saleItem.product.taxRate', 'sale.payments', 'sale.branch');
        $hsDefault = $this->defaultHsCode();
        $taxEnabled = filter_var(Setting::get('tax_enabled', false), FILTER_VALIDATE_BOOLEAN);
        $globalRate = (float) Setting::get('tax_rate', 0);
        $date = ($refund->created_at ?? now())->toDateString();

        $lines = [];
        $kept = []; // tax code => [amount, HS code, taxID]
        foreach ($refund->items as $refundItem) {
            $product = $refundItem->saleItem?->product;
            [$code, $percent] = $this->tax($product, $taxEnabled, $globalRate);
            $taxId = $this->taxId($taxes, $code, $percent, $date);
            $price = (float) ($refundItem->saleItem?->unit_price ?? 0);
            $qty = (float) $refundItem->quantity;
            if ($price <= 0 || $qty <= 0) {
                $price = (float) $refundItem->amount;
                $qty = 1;
            }
            $line = $this->line(count($lines) + 1, 'Sale', $product?->name ?? 'Item', -$price, $qty, $product?->hs_code ?: $hsDefault, $code, $taxId);
            $lines[] = $line;

            $notRefunded = round(abs($line['receiptLineTotal']) - (float) $refundItem->amount, 2);
            if ($notRefunded > 0) {
                $kept[$code] = [($kept[$code][0] ?? 0) + $notRefunded, $line['receiptLineHSCode'] ?? null, $taxId];
            }
        }
        foreach ($kept as $code => [$amount, $hs, $taxId]) {
            $lines[] = $this->line(count($lines) + 1, 'Discount', 'Discount', round($amount, 2), 1, $hs, $code, $taxId);
        }

        $total = $this->total($lines);
        $method = $refund->sale?->payments->first()?->method ?? 'cash';

        return [
            'receiptType' => 'CreditNote',
            'receiptCurrency' => $original->receipt_currency,
            'invoiceNo' => $refund->reference,
            'receiptNotes' => $refund->reason ?: "Refund of {$original->invoice_no}",
            'creditDebitNote' => [
                'deviceID' => $original->device_id,
                'receiptGlobalNo' => $original->receipt_global_no,
                'fiscalDayNo' => $original->fiscal_day_no,
            ],
            'receiptLinesTaxInclusive' => true,
            'receiptLines' => $lines,
            'receiptPayments' => [['moneyTypeCode' => $this->moneyType($method), 'paymentAmount' => $total]],
        ];
    }

    /** What the receipt comes to: the engine totals the lines the same way. */
    public function total(array $lines): float
    {
        return round(array_sum(array_column($lines, 'receiptLineTotal')), 2);
    }

    private function line(int $no, string $type, string $name, float $price, float $qty, ?string $hsCode, string $taxCode, ?int $taxId = null): array
    {
        $price = round($price, 2);
        $qty = round($qty, 3);

        return array_filter([
            'receiptLineType' => $type,
            'receiptLineNo' => $no,
            'receiptLineHSCode' => $hsCode ?: null,
            'receiptLineName' => mb_substr($name, 0, 200),
            'receiptLinePrice' => $price,
            'receiptLineQuantity' => $qty,
            'receiptLineTotal' => round($price * $qty, 2),
            'taxCode' => $taxCode,
            'taxID' => $taxId,
        ], fn ($v) => $v !== null);
    }

    /**
     * GoFiscal's tax codes: A standard rated, B zero rated or non-VAT, C
     * exempt. A store that doesn't charge VAT isn't VAT-registered, so
     * everything it sells is B; a product unticked as Taxable is exempt.
     * With the code, the percent the till charged on it (null: exempt).
     *
     * @return array{0: string, 1: ?float}
     */
    private function tax(?Product $product, bool $taxEnabled, float $globalRate): array
    {
        if (! $taxEnabled) {
            return ['B', 0.0];
        }
        if (! ($product?->is_taxable ?? true)) {
            return ['C', null];
        }
        $rate = (float) ($product?->taxRate?->rate ?? $globalRate);

        return $rate > 0 ? ['A', $rate] : ['B', 0.0];
    }

    /**
     * Which of the device's taxes a line is under, when its code alone doesn't
     * say: ZIMRA can have several on one code valid at once (B is both "Zero
     * rated 0%" and "Non-VAT Withholding Tax 5%"), and the engine then refuses
     * the receipt without a taxID. The one at the percent the till charged is
     * it. Null when the code is enough — or nothing matches, and the engine
     * says so.
     */
    private function taxId(array $taxes, string $code, ?float $percent, string $date): ?int
    {
        $onCode = array_values(array_filter($taxes, fn ($t) => ($t['taxCode'] ?? null) === $code
            && (empty($t['validFrom']) || substr((string) $t['validFrom'], 0, 10) <= $date)
            && (empty($t['validTill']) || substr((string) $t['validTill'], 0, 10) >= $date)));
        if (count($onCode) < 2) {
            return null;
        }
        $charged = array_values(array_filter($onCode, fn ($t) => $percent === null
            ? ($t['taxPercent'] ?? null) === null
            : isset($t['taxPercent']) && abs((float) $t['taxPercent'] - $percent) < 0.001));

        return count($charged) === 1 && isset($charged[0]['taxID']) ? (int) $charged[0]['taxID'] : null;
    }

    private function defaultHsCode(): ?string
    {
        return Setting::get('gofiscal_default_hs_code') ?: null;
    }

    private function currency(Sale $sale): string
    {
        return strtoupper($sale->branch?->currency ?: (string) Setting::get('default_currency', 'USD'));
    }

    /**
     * Payments as the receipt records them: cash handed over beyond the
     * total came back as change, so it comes off the cash first. Anything
     * left unpaid (an account sale) is recorded as Other.
     */
    private function payments(Collection $payments, float $total): array
    {
        $rows = $payments->map(fn ($p) => ['moneyTypeCode' => $this->moneyType($p->method), 'paymentAmount' => round((float) $p->amount, 2)])->all();

        $excess = round(array_sum(array_column($rows, 'paymentAmount')) - $total, 2);
        $order = array_merge(
            array_keys(array_filter($rows, fn ($r) => $r['moneyTypeCode'] === 'Cash')),
            array_reverse(array_keys(array_filter($rows, fn ($r) => $r['moneyTypeCode'] !== 'Cash'))),
        );
        foreach ($order as $i) {
            if ($excess <= 0) {
                break;
            }
            $cut = min($excess, $rows[$i]['paymentAmount']);
            $rows[$i]['paymentAmount'] = round($rows[$i]['paymentAmount'] - $cut, 2);
            $excess = round($excess - $cut, 2);
        }

        $byType = [];
        foreach ($rows as $row) {
            if ($row['paymentAmount'] > 0) {
                $byType[$row['moneyTypeCode']] = round(($byType[$row['moneyTypeCode']] ?? 0) + $row['paymentAmount'], 2);
            }
        }
        $unpaid = round($total - array_sum($byType), 2);
        if ($unpaid > 0) {
            $byType['Other'] = round(($byType['Other'] ?? 0) + $unpaid, 2);
        }

        return array_map(fn ($type, $amount) => ['moneyTypeCode' => $type, 'paymentAmount' => $amount], array_keys($byType), $byType);
    }

    private function moneyType(string $method): string
    {
        return match ($method) {
            'cash' => 'Cash',
            'card' => 'Card',
            'mobile_money' => 'MobileWallet',
            'bank_transfer' => 'BankTransfer',
            default => 'Other', // credit, loyalty_points, other
        };
    }
}
