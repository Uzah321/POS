<?php

namespace Tests\Feature;

use App\Models\License;
use App\Models\Setting;
use App\Models\User;
use App\Services\License\LicenseService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class LicenseTest extends TestCase
{
    use RefreshDatabase;

    private string $tmp;

    protected function setUp(): void
    {
        parent::setUp();

        // A throwaway key pair so the test never needs the real private key.
        $this->tmp = sys_get_temp_dir() . '/lic-' . uniqid();
        mkdir($this->tmp);
        $cnf = getenv('OPENSSL_CONF') ?: null;
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA] + ($cnf ? ['config' => $cnf] : []));
        if (! $key) {
            $this->markTestSkipped('OpenSSL cannot generate keys here (set OPENSSL_CONF).');
        }
        openssl_pkey_export($key, $priv, null, $cnf ? ['config' => $cnf] : []);
        file_put_contents("{$this->tmp}/private.pem", $priv);
        file_put_contents("{$this->tmp}/public.pem", openssl_pkey_get_details($key)['key']);

        Http::fake(['*/api/license/check' => fn() => Http::response(['success' => true, 'data' => app(LicenseService::class)->signedPayload($this->serving)])]);

        config([
            'license.private_key_path' => "{$this->tmp}/private.pem",
            'license.public_key_path'  => "{$this->tmp}/public.pem",
            'license.server_enabled'   => true,
            'license.enforce'          => true,
        ]);
    }

    protected function tearDown(): void
    {
        @unlink("{$this->tmp}/private.pem");
        @unlink("{$this->tmp}/public.pem");
        @rmdir($this->tmp);
        \Illuminate\Support\Carbon::setTestNow();
        parent::tearDown();
    }

    private ?License $serving = null;

    /** Activate this install against a fake server that answers with a real signed payload. */
    private function activate(License $license): array
    {
        $this->serving = $license;
        return app(LicenseService::class)->activate($license->key);
    }

    private function newLicense(int $daysLeft = 30, string $status = 'active'): License
    {
        return License::create(['key' => License::generateKey(), 'client_name' => 'Acme', 'expires_at' => now()->addDays($daysLeft), 'status' => $status]);
    }

    public function test_check_in_returns_a_verifiable_signed_payload(): void
    {
        $license = $this->newLicense();
        $res = $this->postJson('/api/license/check', ['key' => strtolower($license->key)])->assertOk();

        $this->assertTrue(app(LicenseService::class)->verify($res->json('data.payload'), $res->json('data.signature')));
        $this->assertNotNull($license->fresh()->last_seen_at);
    }

    public function test_unknown_key_is_rejected(): void
    {
        $this->postJson('/api/license/check', ['key' => 'NOPE-NOPE-NOPE-NOPE'])->assertNotFound();
    }

    public function test_valid_license_reports_valid_then_expiring_then_expired(): void
    {
        $this->assertSame('valid', $this->activate($this->newLicense(30))['state']);
        $this->assertSame('expiring', $this->activate($this->newLicense(5))['state']);
        $this->assertSame('expired', $this->activate($this->newLicense(-1))['state']);
    }

    public function test_revoked_license_is_reported_revoked(): void
    {
        $this->assertSame('revoked', $this->activate($this->newLicense(30, 'revoked'))['state']);
    }

    public function test_editing_the_stored_state_invalidates_it(): void
    {
        $this->activate($this->newLicense(-1));
        $state = json_decode(Setting::get('license_state'), true);
        $state['payload'] = json_encode(['client' => 'Acme', 'status' => 'active', 'expires_at' => now()->addYear()->toIso8601String()]);
        Setting::set('license_state', json_encode($state));

        $this->assertSame('invalid', app(LicenseService::class)->status()['state']);
    }

    public function test_winding_the_clock_back_does_not_extend_a_license(): void
    {
        $this->activate($this->newLicense(30));
        \Illuminate\Support\Carbon::setTestNow(now()->addDays(10));
        app(LicenseService::class)->status();                // records "seen" 10 days ahead
        \Illuminate\Support\Carbon::setTestNow(now()->subDays(20)); // clock rolled back

        $this->assertSame('expired', app(LicenseService::class)->status()['state']);
    }

    public function test_expired_license_blocks_writes_but_allows_reads(): void
    {
        $this->activate($this->newLicense(-1));
        $user = User::factory()->create();
        $user->givePermissionTo(\Spatie\Permission\Models\Permission::firstOrCreate(['name' => 'manage_settings', 'guard_name' => 'web']));

        $this->actingAs($user)->getJson('/api/license/status')->assertOk()->assertJsonPath('data.state', 'expired');
        $this->actingAs($user)->postJson('/api/sales', [])->assertStatus(402)->assertJsonPath('code', 'LICENSE_EXPIRED');
    }

    public function test_unenforced_install_is_never_blocked(): void
    {
        config(['license.enforce' => false]);
        $this->assertTrue(app(LicenseService::class)->allowsWrites());
    }

    public function test_renew_extends_from_current_expiry(): void
    {
        $license = $this->newLicense(10);
        $before = $license->expires_at->copy();
        $license->renew(1);

        $this->assertTrue($license->fresh()->expires_at->gt($before->addDays(27)));
    }
}
