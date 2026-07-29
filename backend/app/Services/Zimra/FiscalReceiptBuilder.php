<?php

namespace App\Services\Zimra;

use App\Models\FiscalDevice;
use App\Models\FiscalReceipt;
use App\Models\FiscalTaxMapping;
use App\Models\Refund;
use App\Models\Sale;
use App\Models\Setting;
use Illuminate\Support\Collection;

/**
 * Maps a Sale (FiscalInvoice) or Refund (CreditNote) to the ZIMRA `Receipt`
 * payload expected by submitReceipt (§4.7), including the device hash +
 * signature (§13.2.1). receiptCounter/receiptGlobalNo/previousReceiptHash are
 * allocated by FiscalSubmissionService — this class only builds the payload
 * from them, it never allocates numbering itself.
 */
class FiscalReceiptBuilder
{
    public function __construct(private readonly ZimraCryptoService $crypto)
    {
    }

    public function buildForSale(
        Sale $sale,
        FiscalDevice $device,
        int $receiptCounter,
        int $receiptGlobalNo,
        ?string $previousReceiptHash,
    ): array {
        $currency = $sale->branch->currency;
        $taxGroups = $this->groupItemsByTax($sale->items, $device);

        $receiptLines = $this->buildReceiptLines($sale->items, $taxGroups);
        $discountLines = $this->buildCartDiscountLines($sale, $taxGroups, count($receiptLines));
        $receiptLines = [...$receiptLines, ...$discountLines];

        $receiptTaxes = $this->buildReceiptTaxes($taxGroups, $discountLines);
        $receiptPayments = $this->buildReceiptPayments($sale->payments);

        $receiptDate = ($sale->completed_at ?? $sale->created_at)->format('Y-m-d\TH:i:s');

        $deviceSignature = $this->signReceipt(
            device: $device,
            receiptType: 'FiscalInvoice',
            currency: $currency,
            receiptGlobalNo: $receiptGlobalNo,
            receiptDateIso: $receiptDate,
            receiptTotal: (float) $sale->total,
            receiptTaxes: $receiptTaxes,
            previousReceiptHash: $previousReceiptHash,
        );

        return [
            'receiptType' => 'FiscalInvoice',
            'receiptCurrency' => $currency,
            'receiptCounter' => $receiptCounter,
            'receiptGlobalNo' => $receiptGlobalNo,
            'invoiceNo' => $sale->reference,
            'receiptDate' => $receiptDate,
            'receiptLinesTaxInclusive' => true,
            'receiptLines' => $receiptLines,
            'receiptTaxes' => $receiptTaxes,
            'receiptPayments' => $receiptPayments,
            'receiptTotal' => (float) $sale->total,
            'receiptPrintForm' => 'Receipt48',
            'receiptDeviceSignature' => $deviceSignature,
        ];
    }

    /**
     * Builds a CreditNote for a refund. Per RCPT036, a credit note may only
     * reuse tax lines that existed on the original invoice — it cannot
     * introduce a new tax percentage/id — so tax grouping here is driven by
     * the *original* fiscal receipt's payload, not re-derived from products.
     */
    public function buildForRefund(
        Refund $refund,
        FiscalDevice $device,
        int $receiptCounter,
        int $receiptGlobalNo,
        ?string $previousReceiptHash,
        FiscalReceipt $originalFiscalReceipt,
    ): array {
        $originalPayload = $originalFiscalReceipt->payload;
        $currency = $originalPayload['receiptCurrency'];

        $refund->loadMissing('items.saleItem.product');
        $taxGroups = $this->groupRefundItemsByTax($refund, $device);

        $receiptLines = $this->buildRefundReceiptLines($refund, $taxGroups);
        $receiptTaxes = $this->buildReceiptTaxes($taxGroups, []);
        $receiptTotal = -abs((float) $refund->amount);

        $receiptDate = ($refund->completed_at ?? $refund->created_at)->format('Y-m-d\TH:i:s');

        $deviceSignature = $this->signReceipt(
            device: $device,
            receiptType: 'CreditNote',
            currency: $currency,
            receiptGlobalNo: $receiptGlobalNo,
            receiptDateIso: $receiptDate,
            receiptTotal: $receiptTotal,
            receiptTaxes: $receiptTaxes,
            previousReceiptHash: $previousReceiptHash,
        );

        return [
            'receiptType' => 'CreditNote',
            'receiptCurrency' => $currency,
            'receiptCounter' => $receiptCounter,
            'receiptGlobalNo' => $receiptGlobalNo,
            'invoiceNo' => $refund->reference,
            'receiptNotes' => $refund->reason ?: 'Refund of '.$originalPayload['invoiceNo'],
            'receiptDate' => $receiptDate,
            'creditDebitNote' => ['receiptID' => $originalFiscalReceipt->zimra_receipt_id],
            'receiptLinesTaxInclusive' => true,
            'receiptLines' => $receiptLines,
            'receiptTaxes' => $receiptTaxes,
            'receiptPayments' => [['moneyTypeCode' => 'Other', 'paymentAmount' => $receiptTotal]],
            'receiptTotal' => $receiptTotal,
            'receiptPrintForm' => 'Receipt48',
            'receiptDeviceSignature' => $deviceSignature,
        ];
    }

    private function signReceipt(
        FiscalDevice $device,
        string $receiptType,
        string $currency,
        int $receiptGlobalNo,
        string $receiptDateIso,
        float $receiptTotal,
        array $receiptTaxes,
        ?string $previousReceiptHash,
    ): array {
        // §13.2.1: tax lines ordered taxID ascending, then taxCode alphabetically.
        $orderedTaxLines = collect($receiptTaxes)
            ->sortBy([['taxID', 'asc'], ['taxCode', 'asc']])
            ->map(fn (array $tax) => [
                'code' => $tax['taxCode'] ?? '',
                'percent' => $tax['taxPercent'] ?? null,
                'tax_amount' => $tax['taxAmount'],
                'sales_amount_with_tax' => $tax['salesAmountWithTax'],
            ])->values()->all();

        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: $device->device_id,
            receiptType: $receiptType,
            receiptCurrency: $currency,
            receiptGlobalNo: $receiptGlobalNo,
            receiptDateIso: $receiptDateIso,
            receiptTotal: $receiptTotal,
            taxLines: $orderedTaxLines,
            previousReceiptHash: $previousReceiptHash,
        );

        return [
            'hash' => $this->crypto->hash($input),
            'signature' => $this->crypto->sign($input, $device->private_key),
        ];
    }

    /**
     * @return Collection<int, array{mapping: ?FiscalTaxMapping, items: Collection}>
     *         keyed by the product's tax_rate_id (or 'exempt' when not taxable/no rate).
     */
    private function groupItemsByTax(Collection $items, FiscalDevice $device, ?\Closure $productResolver = null): Collection
    {
        $productResolver ??= fn ($item) => $item->product;
        $mappingsByTaxRateId = $device->taxMappings->keyBy('local_tax_rate_id');
        $exemptMapping = $device->taxMappings->firstWhere('local_tax_rate_id', null);
        // Most products in Core never get an explicit tax_rate_id — they just
        // inherit the store-wide rate (see SaleController::store()) — so a
        // ZIMRA tax with no explicit local_tax_rate_id mapping is still
        // auto-matched by percentage, letting the common single-VAT-rate
        // shop fiscalise without an admin having to map anything by hand.
        $mappingsByPercent = $device->taxMappings->keyBy(
            fn (FiscalTaxMapping $m) => $m->tax_percent === null ? 'exempt' : $this->percentKey((float) $m->tax_percent)
        );

        $taxEnabled = filter_var(Setting::get('tax_enabled', false), FILTER_VALIDATE_BOOLEAN);
        $globalTaxRate = (float) Setting::get('tax_rate', 0);

        return $items->groupBy(function ($item) use ($mappingsByTaxRateId, $mappingsByPercent, $taxEnabled, $globalTaxRate, $productResolver) {
            $product = $productResolver($item);
            $isTaxable = $product?->is_taxable ?? true;
            $rateId = $product?->tax_rate_id;

            if (! $taxEnabled || ! $isTaxable) {
                return 'exempt';
            }
            if ($rateId && $mappingsByTaxRateId->has($rateId)) {
                return "rate:{$rateId}";
            }

            $effectiveRate = (float) ($product?->taxRate?->rate ?? $globalTaxRate);
            $percentKey = $this->percentKey($effectiveRate);

            return $mappingsByPercent->has($percentKey) ? "percent:{$percentKey}" : 'exempt';
        })->map(function (Collection $items, string $key) use ($mappingsByTaxRateId, $mappingsByPercent, $exemptMapping) {
            $mapping = match (true) {
                $key === 'exempt' => $exemptMapping,
                str_starts_with($key, 'rate:') => $mappingsByTaxRateId->get((int) substr($key, 5)),
                str_starts_with($key, 'percent:') => $mappingsByPercent->get(substr($key, 8)),
                default => null,
            };

            return ['mapping' => $mapping, 'items' => $items];
        });
    }

    /** Normalizes a tax percent (15, 15.0, 15.00...) to a stable string key for equality matching. */
    private function percentKey(float $percent): string
    {
        return rtrim(rtrim(number_format($percent, 4, '.', ''), '0'), '.') ?: '0';
    }

    private function groupRefundItemsByTax(Refund $refund, FiscalDevice $device): Collection
    {
        return $this->groupItemsByTax($refund->items, $device, fn ($refundItem) => $refundItem->saleItem?->product);
    }

    private function buildReceiptLines(Collection $saleItems, Collection $taxGroups): array
    {
        $mappingByItem = $this->flattenMappingLookup($taxGroups);
        $lineNo = 0;

        return $saleItems->map(function ($item) use (&$lineNo, $mappingByItem) {
            $mapping = $mappingByItem->get($item->id);
            $lineNo++;

            return [
                'receiptLineType' => 'Sale',
                'receiptLineNo' => $lineNo,
                'receiptLineHSCode' => $item->product?->hs_code,
                'receiptLineName' => $item->product?->name ?? 'Item',
                'receiptLinePrice' => (float) $item->unit_price,
                'receiptLineQuantity' => (float) $item->quantity,
                'receiptLineTotal' => (float) $item->total,
                'taxCode' => $mapping ? (string) $mapping->zimra_tax_id : null,
                'taxPercent' => $mapping?->tax_percent !== null ? (float) $mapping->tax_percent : null,
                'taxID' => $mapping?->zimra_tax_id ?? 0,
            ];
        })->values()->all();
    }

    private function buildRefundReceiptLines(Refund $refund, Collection $taxGroups): array
    {
        $mappingByItem = $this->flattenMappingLookup($taxGroups);
        $lineNo = 0;

        return $refund->items->map(function ($refundItem) use (&$lineNo, $mappingByItem) {
            $mapping = $mappingByItem->get($refundItem->id);
            $lineNo++;
            $product = $refundItem->saleItem?->product;

            return [
                'receiptLineType' => 'Sale',
                'receiptLineNo' => $lineNo,
                'receiptLineHSCode' => $product?->hs_code,
                'receiptLineName' => $product?->name ?? 'Item',
                'receiptLinePrice' => $refundItem->saleItem ? -abs((float) $refundItem->saleItem->unit_price) : null,
                'receiptLineQuantity' => (float) $refundItem->quantity,
                'receiptLineTotal' => -abs((float) $refundItem->amount),
                'taxCode' => $mapping ? (string) $mapping->zimra_tax_id : null,
                'taxPercent' => $mapping?->tax_percent !== null ? (float) $mapping->tax_percent : null,
                'taxID' => $mapping?->zimra_tax_id ?? 0,
            ];
        })->values()->all();
    }

    /**
     * A cart-level discount (as opposed to each item's own discount) isn't
     * reflected in any single SaleItem.total, so sum(receiptLines) would
     * otherwise fall short of sale.total (RCPT019). Represent it as one
     * synthetic "Discount" line per tax group, split proportionally to each
     * group's share of the pre-cart-discount subtotal — keeping both the
     * receipt total *and* each tax group's own totals reconciled (RCPT026/027).
     */
    private function buildCartDiscountLines(Sale $sale, Collection $taxGroups, int $startingLineNo): array
    {
        $itemLevelDiscount = $sale->items->sum('discount_amount');
        $cartDiscount = round((float) $sale->discount_amount - (float) $itemLevelDiscount, 2);
        if ($cartDiscount <= 0) {
            return [];
        }

        $subtotal = (float) $sale->items->sum('subtotal');
        if ($subtotal <= 0) {
            return [];
        }

        $lineNo = $startingLineNo;
        $lines = [];
        $remaining = $cartDiscount;
        $groups = $taxGroups->values();

        foreach ($groups as $index => $group) {
            $groupSubtotal = (float) $group['items']->sum('subtotal');
            $isLast = $index === $groups->count() - 1;
            $share = $isLast ? $remaining : round($cartDiscount * ($groupSubtotal / $subtotal), 2);
            $remaining -= $share;
            if ($share <= 0) {
                continue;
            }

            $lineNo++;
            $mapping = $group['mapping'];
            $lines[] = [
                'receiptLineType' => 'Discount',
                'receiptLineNo' => $lineNo,
                'receiptLineName' => 'Discount',
                'receiptLinePrice' => -$share,
                'receiptLineQuantity' => 1,
                'receiptLineTotal' => -$share,
                'taxCode' => $mapping ? (string) $mapping->zimra_tax_id : null,
                'taxPercent' => $mapping?->tax_percent !== null ? (float) $mapping->tax_percent : null,
                'taxID' => $mapping?->zimra_tax_id ?? 0,
                '_group_key' => $group['mapping']?->id ?? 'exempt',
            ];
        }

        return $lines;
    }

    /** @return array<int, array{taxCode: ?string, taxPercent: ?float, taxID: int, taxAmount: float, salesAmountWithTax: float}> */
    private function buildReceiptTaxes(Collection $taxGroups, array $discountLines): array
    {
        return $taxGroups->map(function (array $group) use ($discountLines) {
            $mapping = $group['mapping'];
            $percent = $mapping?->tax_percent !== null ? (float) $mapping->tax_percent : null;
            $taxId = $mapping?->zimra_tax_id ?? 0;

            $salesAmountWithTax = (float) $group['items']->sum('total');
            $groupKey = $mapping?->id ?? 'exempt';
            foreach ($discountLines as $discountLine) {
                if (($discountLine['_group_key'] ?? null) === $groupKey) {
                    $salesAmountWithTax += $discountLine['receiptLineTotal'];
                }
            }

            // receiptLinesTaxInclusive = true, so tax is extracted out of the
            // inclusive amount rather than added on top (RCPT026).
            $taxAmount = $percent
                ? round($salesAmountWithTax - ($salesAmountWithTax / (1 + $percent / 100)), 2)
                : 0.0;

            return [
                'taxCode' => $mapping ? (string) $mapping->zimra_tax_id : null,
                'taxPercent' => $percent,
                'taxID' => $taxId,
                'taxAmount' => $taxAmount,
                'salesAmountWithTax' => round($salesAmountWithTax, 2),
            ];
        })->values()->all();
    }

    private function buildReceiptPayments(Collection $payments): array
    {
        return $payments->map(fn ($payment) => [
            'moneyTypeCode' => match ($payment->method) {
                'cash' => 'Cash',
                'card' => 'Card',
                'mobile_money' => 'MobileWallet',
                'bank_transfer' => 'BankTransfer',
                default => 'Other', // credit, loyalty_points, other — no direct ZIMRA MoneyType equivalent
            },
            'paymentAmount' => (float) $payment->amount,
        ])->values()->all();
    }

    /** Maps each source item's Eloquent id to its tax group's mapping. */
    private function flattenMappingLookup(Collection $taxGroups): Collection
    {
        $lookup = collect();
        foreach ($taxGroups as $group) {
            foreach ($group['items'] as $item) {
                $lookup->put($item->id, $group['mapping']);
            }
        }

        return $lookup;
    }
}
