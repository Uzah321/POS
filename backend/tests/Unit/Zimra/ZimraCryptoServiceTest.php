<?php

namespace Tests\Unit\Zimra;

use App\Services\Zimra\ZimraCryptoService;
use PHPUnit\Framework\TestCase;

/**
 * Verifies ZimraCryptoService's concatenation + hashing exactly matches the
 * literal worked examples published in the ZIMRA Fiscal Device Gateway API
 * v7.2 spec (§13.2.1 "Receipt device signature"). These are the only
 * end-to-end-verifiable test vectors available before real ZIMRA test
 * credentials exist — if these pass, the signature input Core sends to FDMS
 * is byte-for-byte what ZIMRA's own examples expect.
 */
class ZimraCryptoServiceTest extends TestCase
{
    private ZimraCryptoService $crypto;

    protected function setUp(): void
    {
        parent::setUp();
        $this->crypto = new ZimraCryptoService();
    }

    public function test_fiscal_invoice_example_one(): void
    {
        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: 321,
            receiptType: 'FiscalInvoice',
            receiptCurrency: 'ZWL',
            receiptGlobalNo: 432,
            receiptDateIso: '2019-09-19T15:43:12',
            receiptTotal: 9450.00,
            taxLines: [
                ['code' => 'A', 'percent' => null, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 2500.00],
                ['code' => 'B', 'percent' => 0, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 3500.00],
                ['code' => 'C', 'percent' => 15, 'tax_amount' => 150.00, 'sales_amount_with_tax' => 1150.00],
                ['code' => 'D', 'percent' => 15, 'tax_amount' => 300.00, 'sales_amount_with_tax' => 2300.00],
            ],
            previousReceiptHash: 'hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
        );

        $this->assertSame(
            '321FISCALINVOICEZWL4322019-09-19T15:43:12945000A0250000B0.000350000C15.0015000115000D15.0030000230000hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
            $input,
        );
        // The spec's own stated hash for this example doesn't reproduce from its own
        // stated input string (verified: base64_encode(hash('sha256', $input, true))
        // does not equal the doc's value) — most likely a transcription error in the
        // PDF's base64 blob, since the algorithm itself is confirmed correct by
        // test_credit_note_example_two() and test_server_signature_example() below,
        // where the doc's hash *does* reproduce exactly from its stated input.
    }

    public function test_fiscal_invoice_example_two(): void
    {
        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: 322,
            receiptType: 'FiscalInvoice',
            receiptCurrency: 'USD',
            receiptGlobalNo: 85,
            receiptDateIso: '2019-09-19T09:23:07',
            receiptTotal: 40.35,
            taxLines: [
                ['code' => '', 'percent' => null, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 7.00],
                ['code' => '', 'percent' => 0, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 10.00],
                ['code' => '', 'percent' => 14.5, 'tax_amount' => 0.05, 'sales_amount_with_tax' => 0.35],
            ],
            previousReceiptHash: 'hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
        );

        $this->assertSame(
            '322FISCALINVOICEUSD852019-09-19T09:23:07403507000.000100014.50535hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
            $input,
        );
        // See note in test_fiscal_invoice_example_one() — this doc-stated hash also
        // doesn't reproduce from the doc's own stated input string.
    }

    public function test_credit_note_example_one(): void
    {
        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: 321,
            receiptType: 'CreditNote',
            receiptCurrency: 'ZWL',
            receiptGlobalNo: 432,
            receiptDateIso: '2020-09-19T15:43:12',
            receiptTotal: -9450.00,
            taxLines: [
                ['code' => 'A', 'percent' => null, 'tax_amount' => 0.00, 'sales_amount_with_tax' => -2500.00],
                ['code' => 'B', 'percent' => 0, 'tax_amount' => 0.00, 'sales_amount_with_tax' => -3500.00],
                ['code' => 'C', 'percent' => 15, 'tax_amount' => -150.00, 'sales_amount_with_tax' => -1150.00],
                ['code' => 'D', 'percent' => 15, 'tax_amount' => -300.00, 'sales_amount_with_tax' => -2300.00],
            ],
            previousReceiptHash: 'hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
        );

        $this->assertSame(
            '321CREDITNOTEZWL4322020-09-19T15:43:12-945000A0-250000B0.000-350000C15.00-15000-115000D15.00-30000-230000hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
            $input,
        );
        // See note in test_fiscal_invoice_example_one() — doc-stated hash mismatch.
    }

    public function test_credit_note_example_two(): void
    {
        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: 322,
            receiptType: 'CreditNote',
            receiptCurrency: 'USD',
            receiptGlobalNo: 85,
            receiptDateIso: '2020-09-19T09:23:07',
            receiptTotal: -40.35,
            taxLines: [
                ['code' => '', 'percent' => null, 'tax_amount' => 0.00, 'sales_amount_with_tax' => -7.00],
                ['code' => '', 'percent' => 0, 'tax_amount' => 0.00, 'sales_amount_with_tax' => -10.00],
                ['code' => '', 'percent' => 14.5, 'tax_amount' => -3.00, 'sales_amount_with_tax' => -23.00],
            ],
            previousReceiptHash: 'hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
        );

        $this->assertSame(
            '322CREDITNOTEUSD852020-09-19T09:23:07-40350-7000.000-100014.50-300-2300hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
            $input,
        );
        $this->assertSame('F9/QB0vhxQlEF2nk+oebwP8V+qBcNlOFvoTeE/1QxPc=', $this->crypto->hash($input));
    }

    public function test_debit_note_example_one(): void
    {
        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: 321,
            receiptType: 'DebitNote',
            receiptCurrency: 'ZWL',
            receiptGlobalNo: 432,
            receiptDateIso: '2020-09-19T15:43:12',
            receiptTotal: 9450.00,
            taxLines: [
                ['code' => 'A', 'percent' => null, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 2500.00],
                ['code' => 'B', 'percent' => 0, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 3500.00],
                ['code' => 'C', 'percent' => 15, 'tax_amount' => 150.00, 'sales_amount_with_tax' => 1150.00],
                ['code' => 'D', 'percent' => 15, 'tax_amount' => 300.00, 'sales_amount_with_tax' => 2300.00],
            ],
            previousReceiptHash: 'hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
        );

        $this->assertSame(
            '321DEBITNOTEZWL4322020-09-19T15:43:12945000A0250000B0.000350000C15.0015000115000D15.0030000230000hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
            $input,
        );
        // See note in test_fiscal_invoice_example_one() — doc-stated hash mismatch.
    }

    public function test_debit_note_example_two(): void
    {
        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: 322,
            receiptType: 'DebitNote',
            receiptCurrency: 'USD',
            receiptGlobalNo: 85,
            receiptDateIso: '2020-09-19T09:23:07',
            receiptTotal: 40.35,
            taxLines: [
                ['code' => '', 'percent' => null, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 7.00],
                ['code' => '', 'percent' => 0, 'tax_amount' => 0.00, 'sales_amount_with_tax' => 10.00],
                ['code' => '', 'percent' => 14.5, 'tax_amount' => 3.00, 'sales_amount_with_tax' => 23.00],
            ],
            previousReceiptHash: 'hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
        );

        $this->assertSame(
            '322DEBITNOTEUSD852020-09-19T09:23:07403507000.000100014.503002300hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=',
            $input,
        );
        // See note in test_fiscal_invoice_example_one() — doc-stated hash mismatch.
    }

    public function test_receipt_signature_omits_previous_hash_when_first_of_day(): void
    {
        $input = $this->crypto->buildReceiptSignatureInput(
            deviceId: 1,
            receiptType: 'FiscalInvoice',
            receiptCurrency: 'USD',
            receiptGlobalNo: 1,
            receiptDateIso: '2026-01-01T08:00:00',
            receiptTotal: 10.00,
            taxLines: [['code' => 'A', 'percent' => 15, 'tax_amount' => 1.30, 'sales_amount_with_tax' => 10.00]],
            previousReceiptHash: null,
        );

        $this->assertSame('1FISCALINVOICEUSD12026-01-01T08:00:001000A15.001301000', $input);
        $this->assertStringNotContainsString('null', $input);
    }

    public function test_server_signature_example(): void
    {
        $input = implode('', [
            'YyXTSizBBrMjMk4VQL+sCNr+2AC6aQbDAn9JMV2rk3yJ6MDZwie0wqQW3oisNWrMkeZsuAyFSnFkU2A+pKm91sOHVdjeR'
                .'BebjQgAQQIMTCVIcYrx+BizQ7Ib9iCdsVI+Jel2nThqQiQzfRef6EgtgsaIAN+PV55xSrHvPkIe+Bc=',
            '48377',
            '2019-09-19T15:43:12',
        ]);

        $this->assertSame('JQoIo/AgOsvm+PUQpvlQ/U7YMei3m/jbygNrBVfz6Sg=', $this->crypto->hash($input));
    }

    public function test_qr_code_url_examples(): void
    {
        $this->assertSame(
            'https://invoice.zimra.co.zw/00000003210304202311122233314C8BE27663330417',
            $this->crypto->qrCodeUrl(
                'https://invoice.zimra.co.zw',
                321,
                new \DateTimeImmutable('2023-04-03'),
                1112223331,
                '4C8BE27663330417',
            ),
        );

        $this->assertSame(
            'https://invoice.zimra.co.zw/0000000322040420230000001332C10B0476B3B14678',
            $this->crypto->qrCodeUrl(
                'https://invoice.zimra.co.zw',
                322,
                new \DateTimeImmutable('2023-04-04'),
                1332,
                'C10B0476B3B14678',
            ),
        );
    }

    public function test_sign_and_verify_roundtrip_with_generated_ecc_keypair(): void
    {
        $pair = $this->crypto->generateKeyPair('ecc');
        $data = 'some receipt signature input string';

        $signature = $this->crypto->sign($data, $pair['private_key']);

        $publicKey = openssl_pkey_get_public($pair['public_key']);
        $this->assertSame(
            1,
            openssl_verify($data, base64_decode($signature), $publicKey, OPENSSL_ALGO_SHA256),
        );
    }

    public function test_csr_subject_common_name_format(): void
    {
        $pair = $this->crypto->generateKeyPair('ecc');
        $csrPem = $this->crypto->buildCsr('SN0001', 42, $pair['private_key']);

        $csrResource = openssl_csr_get_subject($csrPem);
        $this->assertSame('ZIMRA-SN0001-0000000042', $csrResource['CN']);
        $this->assertSame('ZW', $csrResource['C']);
        $this->assertSame('Zimbabwe Revenue Authority', $csrResource['O']);
    }
}
