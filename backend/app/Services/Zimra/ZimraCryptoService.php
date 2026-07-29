<?php

namespace App\Services\Zimra;

/**
 * Pure cryptographic primitives for ZIMRA Fiscal Device Gateway API v7.2 —
 * keypair/CSR generation (§4.2, §12) and the hash/signature concatenation
 * rules for receipts (§13.2) and fiscal days (§13.3). Deliberately has no
 * dependency on Eloquent models so it can be unit-tested directly against
 * the spec's own worked examples.
 */
class ZimraCryptoService
{
    /**
     * PHP's openssl_pkey_new()/openssl_csr_new() need to load an openssl.cnf
     * even for plain key/CSR generation. On Windows, PHP's default lookup path
     * (Common Files\SSL\openssl.cnf) usually doesn't exist, even though every
     * official PHP-for-Windows build (and the one this app's installer bundles
     * under redist/php) ships its own copy at extras/ssl/openssl.cnf next to
     * php.exe — point at that explicitly so key generation isn't silently
     * broken on a fresh Windows install. Left alone on Linux/Mac, where the
     * system openssl.cnf resolves fine on its own.
     */
    private function opensslConfigArgs(): array
    {
        if (PHP_OS_FAMILY !== 'Windows' || getenv('OPENSSL_CONF')) {
            return [];
        }

        $bundled = dirname(PHP_BINARY).'/extras/ssl/openssl.cnf';

        return is_file($bundled) ? ['config' => $bundled] : [];
    }

    /** @return array{private_key: string, public_key: string} PEM-encoded keypair. */
    public function generateKeyPair(string $algorithm = 'ecc'): array
    {
        $config = ($algorithm === 'rsa'
            ? ['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]
            // ECC ECDSA on SECG secp256r1 (ANSI prime256v1 / NIST P-256) — ZIMRA's
            // own stated first preference, shorter signatures than RSA 2048.
            : ['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC])
            + $this->opensslConfigArgs();

        $resource = openssl_pkey_new($config);
        if ($resource === false) {
            throw new \RuntimeException('Failed to generate key pair: '.openssl_error_string());
        }

        if (! openssl_pkey_export($resource, $privateKeyPem, null, $this->opensslConfigArgs())) {
            throw new \RuntimeException('Failed to export private key: '.openssl_error_string());
        }
        $details = openssl_pkey_get_details($resource);

        return ['private_key' => $privateKeyPem, 'public_key' => $details['key']];
    }

    /**
     * Builds the CSR ZIMRA requires for registerDevice/issueCertificate (§4.2):
     * Subject CN = ZIMRA-<serial>-<10-digit zero-padded deviceId>, plus the
     * fixed C/O/S values ZIMRA validates the CSR against.
     */
    public function buildCsr(string $deviceSerialNo, int $deviceId, string $privateKeyPem): string
    {
        $commonName = sprintf('ZIMRA-%s-%010d', $deviceSerialNo, $deviceId);
        $dn = [
            'countryName'         => 'ZW',
            'organizationName'    => 'Zimbabwe Revenue Authority',
            'stateOrProvinceName' => 'Zimbabwe',
            'commonName'          => $commonName,
        ];

        $privateKey = openssl_pkey_get_private($privateKeyPem);
        if ($privateKey === false) {
            throw new \RuntimeException('Invalid private key: '.openssl_error_string());
        }

        $csrResource = openssl_csr_new($dn, $privateKey, ['digest_alg' => 'sha256'] + $this->opensslConfigArgs());
        if ($csrResource === false) {
            throw new \RuntimeException('Failed to build CSR: '.openssl_error_string());
        }

        openssl_csr_export($csrResource, $csrPem);

        return $csrPem;
    }

    /** SHA-256 hash of $data, base64-encoded — the "hash" half of a SignatureData structure. */
    public function hash(string $data): string
    {
        return base64_encode(hash('sha256', $data, true));
    }

    /** Receipt QR data field (§11): first 16 hex chars of MD5(hex(deviceSignatureBytes)), uppercased. */
    public function qrData(string $base64DeviceSignature): string
    {
        $hex = bin2hex(base64_decode($base64DeviceSignature));

        return strtoupper(substr(md5($hex), 0, 16));
    }

    /** Full QR deep-link URL printed on the receipt (§11). */
    public function qrCodeUrl(string $qrUrlBase, int $deviceId, \DateTimeInterface $receiptDate, int $receiptGlobalNo, string $qrData): string
    {
        return rtrim($qrUrlBase, '/').'/'
            .str_pad((string) $deviceId, 10, '0', STR_PAD_LEFT)
            .$receiptDate->format('dmY')
            .str_pad((string) $receiptGlobalNo, 10, '0', STR_PAD_LEFT)
            .$qrData;
    }

    /** Signs $data with the device private key, base64-encoded — the "signature" half of a SignatureData structure. */
    public function sign(string $data, string $privateKeyPem): string
    {
        $privateKey = openssl_pkey_get_private($privateKeyPem);
        if ($privateKey === false) {
            throw new \RuntimeException('Invalid private key: '.openssl_error_string());
        }

        if (! openssl_sign($data, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('Failed to sign data: '.openssl_error_string());
        }

        return base64_encode($signature);
    }

    /**
     * Amount rendered as an integer-cents string for signature concatenation
     * (e.g. 9450.00 -> "945000", -9450.00 -> "-945000"). Never "-0" since
     * round() of a small negative amount that nets to zero still casts to (int) 0.
     */
    public function centsString(float $amount): string
    {
        return (string) (int) round($amount * 100);
    }

    /** "15.00"/"0.00" when a tax percent applies, "" for exempt (no percent sent) — per §13.2.1 worked examples. */
    public function percentString(null|int|float $percent): string
    {
        return $percent === null ? '' : number_format((float) $percent, 2, '.', '');
    }

    /**
     * Concatenation string for a receipt device signature (§13.2.1). Fields
     * must be in this exact order: deviceID, receiptType, receiptCurrency,
     * receiptGlobalNo, receiptDate, receiptTotal (cents), receiptTaxes, then
     * previousReceiptHash (omitted entirely — not even blank — when this is
     * the first receipt of a fiscal day).
     *
     * @param  array<int, array{code: string, percent: float|null, tax_amount: float, sales_amount_with_tax: float}>  $taxLines
     *         Must already be pre-sorted by the caller: taxID ascending, then
     *         taxCode alphabetically (blank code sorts first) — see §13.2.1.
     */
    public function buildReceiptSignatureInput(
        int $deviceId,
        string $receiptType,
        string $receiptCurrency,
        int $receiptGlobalNo,
        string $receiptDateIso,
        float $receiptTotal,
        array $taxLines,
        ?string $previousReceiptHash,
    ): string {
        $taxPart = '';
        foreach ($taxLines as $line) {
            $taxPart .= $line['code']
                .$this->percentString($line['percent'])
                .$this->centsString($line['tax_amount'])
                .$this->centsString($line['sales_amount_with_tax']);
        }

        $parts = [
            (string) $deviceId,
            strtoupper($receiptType),
            strtoupper($receiptCurrency),
            (string) $receiptGlobalNo,
            $receiptDateIso,
            $this->centsString($receiptTotal),
            $taxPart,
        ];
        if ($previousReceiptHash !== null) {
            $parts[] = $previousReceiptHash;
        }

        return implode('', $parts);
    }

    /**
     * Concatenation string for a fiscal day device signature (§13.3.1):
     * deviceID, fiscalDayNo, fiscalDayDate (the day it was *opened*, YYYY-MM-DD),
     * then the non-zero fiscal counters.
     *
     * NOTE on counter ordering: the spec's prose states type -> currency
     * (alphabetical) -> taxID/moneyType, but its own worked example only holds
     * together under type -> taxID/moneyType -> currency (confirmed against the
     * BalanceByMoneyType rows, consistent with either reading, and the SaleByTax
     * rows, which only match this order). $counters must already be pre-sorted
     * this way, and pre-filtered to exclude zero-value counters, by the caller —
     * see FiscalDeviceService::buildFiscalDayCounterList(). Revisit against
     * ZIMRA's live test environment once credentials are available.
     *
     * @param  array<int, array{type: string, currency: string, percent_or_money_type: string|float|null, value: float}>  $counters
     */
    public function buildFiscalDaySignatureInput(
        int $deviceId,
        int $fiscalDayNo,
        string $fiscalDayDate,
        array $counters,
    ): string {
        $counterPart = '';
        foreach ($counters as $counter) {
            $percentOrMoneyType = $counter['percent_or_money_type'];
            $suffix = is_string($percentOrMoneyType)
                ? strtoupper($percentOrMoneyType)
                : $this->percentString($percentOrMoneyType);

            $counterPart .= strtoupper($counter['type'])
                .strtoupper($counter['currency'])
                .$suffix
                .$this->centsString($counter['value']);
        }

        return implode('', [(string) $deviceId, (string) $fiscalDayNo, $fiscalDayDate, $counterPart]);
    }
}
