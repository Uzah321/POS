<?php

namespace App\Services\Fiscal;

use App\Models\FiscalTaxMapping;
use App\Models\Register;
use App\Services\GoFiscal\GoFiscalClient;
use App\Services\GoFiscal\GoFiscalService;

/**
 * The standard VAT rate ZIMRA holds for this store's fiscal devices: what a
 * taxed sale is recorded at there. Settings' Tax Rate must be the same, or a
 * receipt's VAT says one thing and ZIMRA records another.
 *
 * Through GoFiscal a taxed line goes under code A, and the engine takes its
 * percent from the device's tax list. A device registered with ZIMRA directly
 * matches a line to one of its taxes by percent.
 */
class ZimraVatRates
{
    public function __construct(private readonly GoFiscalService $goFiscal)
    {
    }

    /**
     * @return list<float> Each distinct standard rate, lowest first. Empty when
     *                     nothing fiscalises, or the devices' taxes can't be had.
     */
    public function standardRates(): array
    {
        $today = now()->toDateString();
        $rates = [];

        if (GoFiscalClient::storedKey()) {
            $devices = Register::whereNotNull('gofiscal_device_id')->pluck('gofiscal_device_id')
                ->map(fn ($id) => (int) $id)->unique();
            foreach ($devices as $deviceId) {
                foreach ($this->goFiscal->taxes($deviceId) as $tax) {
                    $percent = $tax['taxPercent'] ?? null;
                    if (($tax['taxCode'] ?? null) === 'A' && is_numeric($percent) && $percent > 0
                        && (empty($tax['validFrom']) || substr((string) $tax['validFrom'], 0, 10) <= $today)
                        && (empty($tax['validTill']) || substr((string) $tax['validTill'], 0, 10) >= $today)) {
                        $rates[] = (float) $percent;
                    }
                }
            }
        }

        // A direct device's list also has withholding taxes, which no sale charges.
        $direct = FiscalTaxMapping::where('tax_percent', '>', 0)
            ->where(fn ($q) => $q->whereNull('valid_from')->orWhereDate('valid_from', '<=', $today))
            ->where(fn ($q) => $q->whereNull('valid_till')->orWhereDate('valid_till', '>=', $today))
            ->get(['tax_percent', 'tax_name'])
            ->reject(fn (FiscalTaxMapping $m) => str_contains(strtolower((string) $m->tax_name), 'withholding'))
            ->map(fn (FiscalTaxMapping $m) => (float) $m->tax_percent);

        $unique = [];
        foreach ([...$rates, ...$direct] as $rate) {
            $unique[self::format($rate)] = round($rate, 4);
        }
        sort($unique);

        return array_values($unique);
    }

    public static function matches(float $rate, array $rates): bool
    {
        foreach ($rates as $zimra) {
            if (abs($rate - $zimra) < 0.0001) {
                return true;
            }
        }

        return false;
    }

    /** 15.5 as "15.5", 15.0 as "15". */
    public static function format(float $rate): string
    {
        return rtrim(rtrim(number_format($rate, 4, '.', ''), '0'), '.') ?: '0';
    }
}
