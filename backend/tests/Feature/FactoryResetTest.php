<?php

namespace Tests\Feature;

use App\Models\Setting;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * system:factory-reset erases every business record and user, keeps the
 * licences and the ZIMRA fiscal registration, and leaves one new admin.
 */
class FactoryResetTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Demo branch, users, products, customers, suppliers, stock, sales and expenses
        $this->seed(DatabaseSeeder::class);

        DB::table('licenses')->insert(['key' => 'CORE-TEST-0001', 'client_name' => 'Other Shop', 'expires_at' => now()->addYear(), 'created_at' => now(), 'updated_at' => now()]);
        Setting::set('license_key', 'CORE-SITE-KEY', 'license');
        Setting::set('license_state', '{"signed":"payload"}', 'license');
        Setting::set('fiscal_device_id', '12345', 'fiscal');
    }

    private function reset(string $phrase = 'ERASE ALL DATA')
    {
        $command = $this->artisan('system:factory-reset', ['--skip-backup' => true])
            ->expectsQuestion('Type ERASE ALL DATA to continue', $phrase);
        if ($phrase !== 'ERASE ALL DATA') {
            return $command->assertFailed();
        }
        return $command
            ->expectsQuestion('Full name', 'Dingu Owner')
            ->expectsQuestion('Username', 'owner')
            ->expectsQuestion('Email (optional, press Enter to skip)', '')
            ->expectsQuestion('Password (at least 8 characters)', 'short')
            ->expectsQuestion('Password (at least 8 characters)', 'Str0ng-pass!')
            ->expectsQuestion('Type the password again', 'Str0ng-pass!')
            ->assertSuccessful();
    }

    /** A ZIMRA device on its own register in a branch of its own, with a fiscal receipt for one of the sales. */
    private function registerFiscalDevice(): array
    {
        $branchId = DB::table('branches')->insertGetId(['name' => 'Fiscal Branch', 'code' => 'FIS', 'currency' => 'USD', 'is_main' => false, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $registerId = DB::table('registers')->insertGetId(['branch_id' => $branchId, 'name' => 'Till 1', 'created_at' => now(), 'updated_at' => now()]);
        $deviceId = DB::table('fiscal_devices')->insertGetId(['register_id' => $registerId, 'next_receipt_global_no' => 42, 'created_at' => now(), 'updated_at' => now()]);
        $taxRateId = DB::table('tax_rates')->where('rate', 15)->value('id');
        DB::table('fiscal_tax_mappings')->insert(['fiscal_device_id' => $deviceId, 'zimra_tax_id' => 1, 'tax_name' => 'VAT', 'valid_from' => now()->toDateString(), 'local_tax_rate_id' => $taxRateId, 'created_at' => now(), 'updated_at' => now()]);
        $dayId = DB::table('fiscal_days')->insertGetId(['fiscal_device_id' => $deviceId, 'fiscal_day_no' => 7, 'opened_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('fiscal_receipts')->insert([
            'fiscal_device_id' => $deviceId, 'fiscal_day_id' => $dayId, 'sale_id' => DB::table('sales')->value('id'),
            'receipt_type' => 'FiscalInvoice', 'receipt_counter' => 1, 'receipt_global_no' => 41, 'invoice_no' => 'INV-41',
            'receipt_currency' => 'USD', 'receipt_total' => 10, 'payload' => '{}', 'device_hash' => 'h', 'device_signature' => 's',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        return ['branch' => $branchId, 'register' => $registerId, 'device' => $deviceId, 'taxRate' => $taxRateId];
    }

    public function test_it_erases_everything_and_leaves_one_new_admin(): void
    {
        $this->assertGreaterThan(0, DB::table('sales')->count(), 'the demo data should include sales');
        $roles = DB::table('roles')->count();

        $this->reset();

        foreach (['sales', 'sale_items', 'sale_payments', 'products', 'stocks', 'customers', 'suppliers', 'expenses', 'categories', 'brands', 'personal_access_tokens'] as $table) {
            $this->assertSame(0, DB::table($table)->count(), "{$table} should be empty");
        }
        $this->assertSame(['owner'], DB::table('users')->pluck('username')->all());
        $this->assertNull(Setting::get('company_name'));

        // A fresh install's starting point
        $this->assertSame(['Main Branch'], DB::table('branches')->pluck('name')->all());
        $this->assertSame(1, DB::table('warehouses')->count());
        $this->assertSame(2, DB::table('tax_rates')->count());
        $this->assertSame(3, DB::table('currencies')->count());
        $this->assertSame($roles, DB::table('roles')->count());
        $this->assertNotNull(Setting::get('data_reset_at'));

        // Kept
        $this->assertSame(['CORE-TEST-0001'], DB::table('licenses')->pluck('key')->all());
        $this->assertSame('CORE-SITE-KEY', Setting::get('license_key'));
        $this->assertSame('{"signed":"payload"}', Setting::get('license_state'));
        $this->assertSame('12345', Setting::get('fiscal_device_id'));

        // The new admin can sign in and is an admin
        $this->postJson('/api/auth/login', ['username' => 'owner', 'password' => 'Str0ng-pass!'])->assertOk();
        $this->assertTrue(\App\Models\User::where('username', 'owner')->first()->hasRole('admin'));
    }

    public function test_the_zimra_registration_and_what_it_hangs_off_survive(): void
    {
        $fiscal = $this->registerFiscalDevice();

        $this->reset();

        $this->assertSame(42, (int) DB::table('fiscal_devices')->where('id', $fiscal['device'])->value('next_receipt_global_no'));
        $this->assertSame(1, DB::table('fiscal_days')->count());
        $receipt = DB::table('fiscal_receipts')->first();
        $this->assertSame(41, (int) $receipt->receipt_global_no);
        $this->assertNull($receipt->sale_id, 'the sale it was for is gone');
        $this->assertSame($fiscal['taxRate'], DB::table('fiscal_tax_mappings')->value('local_tax_rate_id'));
        $this->assertSame([$fiscal['taxRate']], DB::table('tax_rates')->pluck('id')->all());
        $this->assertSame([$fiscal['register']], DB::table('registers')->pluck('id')->all());

        // The fiscal branch is the only one left, and becomes the main one
        $this->assertSame([$fiscal['branch']], DB::table('branches')->pluck('id')->all());
        $this->assertTrue((bool) DB::table('branches')->value('is_main'));
        $this->assertSame($fiscal['branch'], DB::table('users')->value('branch_id'));
        $this->assertSame($fiscal['branch'], DB::table('warehouses')->value('branch_id'));
    }

    public function test_nothing_changes_without_the_exact_phrase(): void
    {
        $sales = DB::table('sales')->count();
        $users = DB::table('users')->count();

        $this->reset('erase all data');

        $this->assertSame($sales, DB::table('sales')->count());
        $this->assertSame($users, DB::table('users')->count());
    }
}
