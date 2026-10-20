<?php

namespace App\Support;

use RuntimeException;

/**
 * Signing for QZ Tray, the program on a till computer that lets the browser
 * list its printers and print without a dialog. QZ Tray only stops asking
 * "Allow?" for requests signed with a certificate it trusts, so each install
 * makes its own small certificate authority the first time it's needed:
 *
 * - override.crt — the authority's certificate. A till copies it into QZ
 *   Tray's folder, which makes QZ Tray trust what it issued.
 * - site.crt — the certificate it issued for this site, handed to QZ Tray
 *   when the till connects.
 * - site.key — site.crt's private key, which signs each request. It never
 *   leaves the server; the authority's own key isn't kept at all.
 */
class QzTraySigning
{
    private const DIR = 'app/qz-tray';
    private const FILES = ['override.crt', 'site.crt', 'site.key'];

    /** The certificate a till installs in QZ Tray as override.crt. */
    public static function trustCertificate(): string
    {
        return self::read('override.crt');
    }

    /** The certificate QZ Tray checks this site's signatures against. */
    public static function siteCertificate(): string
    {
        return self::read('site.crt');
    }

    /** A request from qz-tray.js (the hash it asks to have signed), signed SHA512withRSA, as base64. */
    public static function sign(string $request): string
    {
        $key = openssl_pkey_get_private(self::read('site.key'));
        if ($key === false || ! openssl_sign($request, $signature, $key, OPENSSL_ALGO_SHA512)) {
            throw new RuntimeException('Could not sign the QZ Tray request: ' . (openssl_error_string() ?: 'unknown error'));
        }
        return base64_encode($signature);
    }

    private static function read(string $file): string
    {
        self::ensureMade();
        return (string) file_get_contents(self::path($file));
    }

    private static function path(string $file = ''): string
    {
        return storage_path(self::DIR . ($file === '' ? '' : '/' . $file));
    }

    private static function made(): bool
    {
        foreach (self::FILES as $file) {
            if (! is_file(self::path($file))) {
                return false;
            }
        }
        return true;
    }

    /** Two tills asking at once still end up with one set. */
    private static function ensureMade(): void
    {
        if (self::made()) {
            return;
        }
        $dir = self::path();
        if (! is_dir($dir) && ! mkdir($dir, 0750, true) && ! is_dir($dir)) {
            throw new RuntimeException("Could not create {$dir}");
        }
        $lock = fopen($dir . '/.lock', 'c');
        flock($lock, LOCK_EX);
        try {
            if (! self::made()) {
                self::make();
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private static function make(): void
    {
        $host = parse_url((string) config('app.url'), PHP_URL_HOST) ?: 'localhost';

        // Its own OpenSSL config, so this works without a system openssl.cnf
        // (a Windows install has none) and the two certificates get the right
        // extensions: an authority that can issue, and a site one that can't.
        $config = tempnam(sys_get_temp_dir(), 'qz');
        file_put_contents($config, <<<'CNF'
            [ req ]
            distinguished_name = dn
            [ dn ]
            [ authority ]
            basicConstraints = critical, CA:TRUE
            keyUsage = critical, keyCertSign, cRLSign
            [ site ]
            basicConstraints = critical, CA:FALSE
            keyUsage = critical, digitalSignature
            CNF);

        try {
            $options = ['config' => $config, 'private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA, 'digest_alg' => 'sha256'];

            $authorityKey = self::check(openssl_pkey_new($options));
            $authorityCsr = self::check(openssl_csr_new(['commonName' => "Core POS printing ({$host})", 'organizationName' => 'Core POS'], $authorityKey, $options));
            $authority = self::check(openssl_csr_sign($authorityCsr, null, $authorityKey, 7300, $options + ['x509_extensions' => 'authority'], random_int(1, PHP_INT_MAX)));

            $siteKey = self::check(openssl_pkey_new($options));
            $siteCsr = self::check(openssl_csr_new(['commonName' => $host, 'organizationName' => 'Core POS'], $siteKey, $options));
            $site = self::check(openssl_csr_sign($siteCsr, $authority, $authorityKey, 3650, $options + ['x509_extensions' => 'site'], random_int(1, PHP_INT_MAX)));

            self::check(openssl_x509_export($authority, $authorityPem));
            self::check(openssl_x509_export($site, $sitePem));
            self::check(openssl_pkey_export($siteKey, $siteKeyPem, null, $options));
        } finally {
            @unlink($config);
        }

        // The key first, readable by the web server alone; the set only counts as made once all three are written.
        self::write('site.key', $siteKeyPem, 0600);
        self::write('site.crt', $sitePem, 0644);
        self::write('override.crt', $authorityPem, 0644);
    }

    private static function write(string $file, string $contents, int $mode): void
    {
        $path = self::path($file);
        if (file_put_contents($path, $contents) === false) {
            throw new RuntimeException("Could not write {$path}");
        }
        @chmod($path, $mode);
    }

    /** @template T @param T|false $result @return T */
    private static function check(mixed $result): mixed
    {
        if ($result === false) {
            throw new RuntimeException('Could not make the QZ Tray certificates: ' . (openssl_error_string() ?: 'unknown error'));
        }
        return $result;
    }
}
