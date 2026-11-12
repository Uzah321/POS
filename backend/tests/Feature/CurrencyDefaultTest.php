<?php

namespace Tests\Feature;

use App\Models\Currency;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * USD is the base (rate always 1, can't be removed); exactly one currency is
 * the default, and it is always active.
 */
class CurrencyDefaultTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::create([
            'name' => 'Admin', 'username' => 'admin' . uniqid(), 'password' => bcrypt('secret1'), 'is_active' => true,
        ]);
        Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web']);
        $this->user->assignRole('admin');

        // (The repair migration already made USD on the fresh test database.)
        Currency::updateOrCreate(['code' => 'USD'], ['name' => 'US Dollar', 'symbol' => '$', 'exchange_rate' => 1, 'is_default' => true, 'is_active' => true]);
        Currency::updateOrCreate(['code' => 'ZWG'], ['name' => 'Zimbabwe Gold', 'symbol' => 'ZiG', 'exchange_rate' => 26.8, 'is_default' => false, 'is_active' => true]);
        Currency::updateOrCreate(['code' => 'ZAR'], ['name' => 'Rand', 'symbol' => 'R', 'exchange_rate' => 18.45, 'is_default' => false, 'is_active' => false]);
    }

    private function cur(string $code): Currency
    {
        return Currency::where('code', $code)->firstOrFail();
    }

    public function test_making_another_currency_the_default_moves_the_default(): void
    {
        $this->actingAs($this->user)->putJson('/api/currencies/' . $this->cur('ZWG')->id, ['is_default' => true])->assertOk();

        $this->assertTrue($this->cur('ZWG')->is_default);
        $this->assertFalse($this->cur('USD')->is_default);
        $this->assertSame(1, Currency::where('is_default', true)->count());
    }

    public function test_an_inactive_currency_made_default_is_switched_on(): void
    {
        $this->actingAs($this->user)->putJson('/api/currencies/' . $this->cur('ZAR')->id, ['is_default' => true])->assertOk();

        $this->assertTrue($this->cur('ZAR')->is_default);
        $this->assertTrue($this->cur('ZAR')->is_active);
        $this->assertSame(['USD', 'ZAR', 'ZWG'], collect($this->getJson('/api/currencies')->json('data'))->pluck('code')->all());
    }

    public function test_the_default_cant_be_unticked_or_switched_off(): void
    {
        $usd = $this->cur('USD');
        $this->actingAs($this->user)->putJson("/api/currencies/{$usd->id}", ['is_default' => false])->assertStatus(422);
        $this->actingAs($this->user)->putJson("/api/currencies/{$usd->id}", ['is_active' => false])->assertStatus(422);

        $this->assertTrue($this->cur('USD')->is_default);
        $this->assertTrue($this->cur('USD')->is_active);
    }

    public function test_the_base_rate_stays_1_and_the_base_cant_be_deleted(): void
    {
        $usd = $this->cur('USD');
        $this->actingAs($this->user)->putJson("/api/currencies/{$usd->id}", ['exchange_rate' => 2.5, 'name' => 'Dollar'])->assertOk();
        $this->assertEquals(1, (float) $this->cur('USD')->exchange_rate);
        $this->assertSame('Dollar', $this->cur('USD')->name);

        // Not the default any more, and still protected.
        $this->actingAs($this->user)->putJson('/api/currencies/' . $this->cur('ZWG')->id, ['is_default' => true])->assertOk();
        $this->actingAs($this->user)->deleteJson("/api/currencies/{$usd->id}")->assertStatus(422);
        $this->assertNotNull(Currency::where('code', 'USD')->first());
    }

    public function test_other_rates_still_change(): void
    {
        $zwg = $this->cur('ZWG');
        $this->actingAs($this->user)->putJson("/api/currencies/{$zwg->id}", ['exchange_rate' => 27.15])->assertOk();
        $this->assertEquals(27.15, (float) $this->cur('ZWG')->exchange_rate);
    }

    public function test_the_repair_migration_fixes_a_broken_setup(): void
    {
        DB::table('currencies')->where('code', 'USD')->update(['exchange_rate' => 3, 'is_default' => false]);
        DB::table('currencies')->where('code', 'ZAR')->update(['is_default' => true]); // inactive default
        DB::table('currencies')->where('code', 'ZWG')->update(['is_default' => true]);

        (require base_path('database/migrations/2026_11_12_000001_repair_currency_base_and_default.php'))->up();

        $this->assertEquals(1, (float) $this->cur('USD')->exchange_rate);
        $this->assertSame(1, Currency::where('is_default', true)->count());
        $this->assertTrue($this->cur('ZWG')->is_default, 'the active default is kept');
    }
}
