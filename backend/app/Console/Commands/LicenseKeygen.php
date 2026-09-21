<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class LicenseKeygen extends Command
{
    protected $signature = 'license:keygen {--force : Replace an existing key pair}';
    protected $description = 'Generate the RSA key pair used to sign licenses (private stays on the vendor server, public ships with the app)';

    public function handle(): int
    {
        $private = config('license.private_key_path');
        $public = config('license.public_key_path');

        if (file_exists($private) && ! $this->option('force')) {
            $this->error('A private key already exists. Replacing it invalidates every issued license. Use --force to confirm.');
            return self::FAILURE;
        }

        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        if (! $key) {
            $this->error('OpenSSL could not create a key: ' . openssl_error_string() . ' (on Windows, set OPENSSL_CONF to your php/extras/ssl/openssl.cnf)');
            return self::FAILURE;
        }
        openssl_pkey_export($key, $privatePem);
        $publicPem = openssl_pkey_get_details($key)['key'];

        @mkdir(dirname($private), 0700, true);
        file_put_contents($private, $privatePem);
        @chmod($private, 0600);
        file_put_contents($public, $publicPem);

        $this->info("Private key: {$private}  (keep secret, never commit)");
        $this->info("Public key:  {$public}  (commit — clients use it to verify licenses)");
        return self::SUCCESS;
    }
}
