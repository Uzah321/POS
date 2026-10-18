<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Signing in from a browser must leave a session behind whatever address the
 * POS was opened on — a till's LAN IP, localhost:8080, the VPS by IP. If the
 * address isn't trusted, login still "succeeds" but the next request 401s and
 * the user is thrown straight back to the login screen.
 */
class BrowserSignInTest extends TestCase
{
    use RefreshDatabase;

    private function signInFrom(string $address): void
    {
        User::create([
            'name' => 'Till', 'username' => 'till', 'password' => bcrypt('secret1'), 'is_active' => true,
        ]);

        // A same-origin browser request: the page and the API share one address.
        $headers = ['Referer' => "http://{$address}/login", 'Host' => $address];

        $this->withHeaders($headers)->withoutMiddleware(\Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class)
            ->postJson("http://{$address}/api/auth/login", ['username' => 'till', 'password' => 'secret1'])
            ->assertOk();

        $this->withHeaders($headers)->getJson("http://{$address}/api/auth/me")->assertOk();
    }

    public function test_signing_in_from_a_lan_ip_keeps_the_user_signed_in(): void
    {
        $this->signInFrom('192.168.1.10:8080');
    }

    public function test_signing_in_to_the_online_server_by_its_ip_keeps_the_user_signed_in(): void
    {
        $this->signInFrom('203.0.113.5');
    }

    public function test_a_wrong_attendance_pin_does_not_look_like_an_expired_session(): void
    {
        $user = User::create([
            'name' => 'Till', 'username' => 'till', 'password' => bcrypt('secret1'), 'is_active' => true, 'pin' => '1234',
        ]);

        $this->actingAs($user)->postJson('/api/auth/pin-login', ['pin' => '9999'])->assertStatus(422);
    }
}
