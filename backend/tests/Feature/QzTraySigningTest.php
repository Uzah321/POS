<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * QZ Tray trusts this site through its own small certificate authority: the
 * till installs override.crt, QZ Tray is shown the site certificate it
 * issued, and each request is signed with that certificate's key.
 */
class QzTraySigningTest extends TestCase
{
    use RefreshDatabase;

    private string $storage;

    protected function setUp(): void
    {
        parent::setUp();
        $this->storage = sys_get_temp_dir() . '/qz-tray-test-' . uniqid();
        File::ensureDirectoryExists($this->storage . '/app');
        $this->app->useStoragePath($this->storage);
        config(['app.url' => 'https://mycorre.com']);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->storage);
        parent::tearDown();
    }

    private function user(): User
    {
        return User::create(['name' => 'Cashier', 'username' => 'cashier' . uniqid(), 'password' => bcrypt('secret1'), 'is_active' => true]);
    }

    public function test_the_site_certificate_is_issued_by_the_one_tills_install(): void
    {
        $user = $this->user();
        $site = $this->actingAs($user)->get('/api/qz-tray/certificate')->assertOk()->getContent();
        $download = $this->actingAs($user)->get('/api/qz-tray/override-certificate')->assertOk();
        $this->assertStringContainsString('attachment; filename="override.crt"', $download->headers->get('Content-Disposition'));
        $authority = $download->getContent();

        $this->assertSame(1, openssl_x509_verify($site, openssl_pkey_get_public($authority)));
        $this->assertNotSame(1, openssl_x509_verify($authority, openssl_pkey_get_public($site)));

        $siteInfo = openssl_x509_parse($site);
        $authorityInfo = openssl_x509_parse($authority);
        $this->assertSame('mycorre.com', $siteInfo['subject']['CN']);
        $this->assertStringContainsString('CA:FALSE', $siteInfo['extensions']['basicConstraints']);
        $this->assertStringContainsString('CA:TRUE', $authorityInfo['extensions']['basicConstraints']);
        $this->assertGreaterThan(now()->addYears(9)->timestamp, $siteInfo['validTo_time_t']);
        $this->assertSame(2048, openssl_pkey_get_details(openssl_pkey_get_public($site))['bits']);
    }

    public function test_requests_are_signed_the_way_qz_tray_checks_them(): void
    {
        $user = $this->user();
        $site = $this->actingAs($user)->get('/api/qz-tray/certificate')->getContent();
        // qz-tray.js asks for the SHA-256 hex of the call to be signed.
        $request = hash('sha256', '{"call":"printers.find","params":{},"timestamp":1760947200000}');

        $signature = $this->actingAs($user)->postJson('/api/qz-tray/sign', ['request' => $request])->assertOk()->json('data.signature');

        $this->assertSame(1, openssl_verify($request, base64_decode($signature), openssl_pkey_get_public($site), OPENSSL_ALGO_SHA512));
        $this->assertSame(0, openssl_verify($request . 'x', base64_decode($signature), openssl_pkey_get_public($site), OPENSSL_ALGO_SHA512));
    }

    public function test_the_certificates_are_made_once_and_the_key_stays_on_the_server(): void
    {
        $user = $this->user();
        $first = $this->actingAs($user)->get('/api/qz-tray/certificate')->getContent();
        $second = $this->actingAs($user)->get('/api/qz-tray/certificate')->getContent();
        $this->assertSame($first, $second);

        foreach (['/api/qz-tray/certificate', '/api/qz-tray/override-certificate'] as $url) {
            $this->assertStringNotContainsString('PRIVATE KEY', $this->actingAs($user)->get($url)->getContent());
        }
        $this->assertFileExists($this->storage . '/app/qz-tray/site.key');
    }

    public function test_only_signed_in_users_get_signatures(): void
    {
        $this->postJson('/api/qz-tray/sign', ['request' => str_repeat('a', 64)])->assertUnauthorized();
        $this->getJson('/api/qz-tray/certificate')->assertUnauthorized();
        $this->actingAs($this->user())->postJson('/api/qz-tray/sign', [])->assertUnprocessable();
    }
}
