<?php

namespace App\Console\Commands;

use App\Models\Branch;
use App\Models\Setting;
use App\Models\User;
use App\Models\Warehouse;
use Database\Seeders\ReferenceDataSeeder;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Symfony\Component\Process\Process;

/**
 * Erases every business record and every user, to start the system over
 * from nothing — except what other parties hold this system to:
 *  - licences: this site's own, and the ones it has issued to other
 *    installs (they check in with it);
 *  - the ZIMRA fiscal registration: fiscal devices (certificate, keys,
 *    receipt numbering), their fiscal days and fiscal receipts as ZIMRA's
 *    record, the tax mappings, and the registers, branches and tax rates
 *    those hang off — and likewise GoFiscal's: its API key, its receipts,
 *    and the tills linked to its devices;
 *  - the roles/permissions structure and the migrations table.
 *
 * Takes a database backup first, then wipes and starts over in one
 * transaction — any error puts everything back. Leaves one new admin plus
 * the reference lists a new install starts with (ReferenceDataSeeder), and
 * a data_reset_at setting that tells each till to drop its local copy of
 * the old sales. On the server: sudo bash factory-reset.sh
 */
class FactoryReset extends Command
{
    protected $signature = 'system:factory-reset {--skip-backup : Wipe without taking a database backup first}';
    protected $description = 'Erase all data and users (keeping licences and the ZIMRA fiscal registration) and create one new admin';

    private const CONFIRMATION = 'ERASE ALL DATA';

    /** Never touched. */
    private const KEEP_TABLES = [
        'migrations', 'licenses', 'roles', 'permissions', 'role_has_permissions',
        'fiscal_devices', 'fiscal_days', 'fiscal_receipts', 'fiscal_tax_mappings', 'gofiscal_receipts',
    ];

    /** Settings kept: the licence, the fiscal fields printed on receipts, and GoFiscal's API key and HS code. */
    private const KEEP_SETTING_PREFIXES = ['license_', 'fiscal_', 'gofiscal_'];

    /** @var array<string, \Closure(Builder): Builder> Tables only partly erased: narrows a query to the rows that go. */
    private array $partial = [];

    public function handle(): int
    {
        if (! $this->input->isInteractive()) {
            $this->error('Run this in a terminal — it asks you to confirm, and for the new admin\'s password.');
            return self::FAILURE;
        }

        // This connection's own tables — on Postgres, only the schemas on its
        // search path, not every schema in the database.
        $tables = Schema::getTableListing(Schema::getCurrentSchemaListing(), schemaQualified: false);
        $this->describe($tables);

        if (trim((string) $this->ask('Type ' . self::CONFIRMATION . ' to continue')) !== self::CONFIRMATION) {
            $this->info('Nothing was changed.');
            return self::FAILURE;
        }

        $this->newLine();
        $this->line('The new admin login:');
        $name = trim((string) $this->ask('Full name', 'Administrator'));
        $username = trim((string) $this->ask('Username', 'admin'));
        $email = trim((string) $this->ask('Email (optional, press Enter to skip)', '')) ?: null;
        $password = $this->askPassword();

        $backup = null;
        if (! $this->option('skip-backup')) {
            $this->info('Backing up the database…');
            $backup = $this->backup();
            if ($backup === null) {
                $this->error('The backup failed, so nothing was erased. Fix the backup (or run with --skip-backup) and try again.');
                return self::FAILURE;
            }
            $this->info("Backup saved: {$backup}");
        }

        $this->info('Erasing…');
        DB::transaction(function () use ($tables, $name, $username, $email, $password) {
            $this->wipe($tables);
            $this->startOver($name, $username, $email, $password);
        });

        foreach (['permission:cache-reset', 'cache:clear'] as $command) {
            try { Artisan::call($command); } catch (\Throwable) { /* stale cache only */ }
        }

        $this->newLine();
        $this->info('Done — the system is empty.');
        $this->line("Sign in as \"{$username}\" with the password you just set. Everyone else has been signed out.");
        if ($backup) {
            $this->line("The old data is in {$backup} — copy it somewhere safe.");
        }
        return self::SUCCESS;
    }

    /** What goes and what stays, with counts. */
    private function describe(array $tables): void
    {
        $this->warn('This ERASES ALL DATA on ' . config('app.url') . ' — every sale, product, customer, supplier,');
        $this->warn('purchase, expense, stock record, setting and user. It cannot be undone.');
        $this->newLine();

        $rows = [];
        foreach (['sales' => 'Sales', 'products' => 'Products', 'customers' => 'Customers', 'suppliers' => 'Suppliers', 'users' => 'Users'] as $table => $label) {
            if (in_array($table, $tables, true)) {
                $rows[] = [$label, number_format(DB::table($table)->count()), 'erased'];
            }
        }
        foreach (['licenses' => 'Licences (this site\'s and issued to other installs)', 'fiscal_devices' => 'ZIMRA fiscal devices', 'fiscal_receipts' => 'ZIMRA fiscal receipts'] as $table => $label) {
            if (in_array($table, $tables, true)) {
                $rows[] = [$label, number_format(DB::table($table)->count()), 'kept'];
            }
        }
        $this->table(['', 'Count', ''], $rows);
        $this->line('Also kept: the branches, registers and tax rates the ZIMRA devices use, and the roles & permissions.');
        $this->line('Afterwards there is one admin login (you set it next), plus currencies, units, tax rates and expense categories.');
        $this->newLine();
    }

    private function askPassword(): string
    {
        while (true) {
            $password = (string) $this->secret('Password (at least 8 characters)');
            if (strlen($password) < 8) {
                $this->error('That\'s too short.');
                continue;
            }
            if ((string) $this->secret('Type the password again') !== $password) {
                $this->error('The passwords don\'t match.');
                continue;
            }
            return $password;
        }
    }

    /** A full dump of the database into storage/app/backups, or null if it couldn't be made. */
    private function backup(): ?string
    {
        $db = config('database.connections.' . config('database.default'));
        $dir = storage_path('app/backups');
        if (! is_dir($dir) && ! mkdir($dir, 0750, true) && ! is_dir($dir)) {
            return null;
        }
        $base = $dir . '/before-factory-reset-' . now()->format('Y-m-d_His');

        switch ($db['driver']) {
            case 'pgsql':
                $file = "{$base}.dump";
                $process = new Process(
                    ['pg_dump', '--format=custom', '--no-owner', "--file={$file}", "--host={$db['host']}", "--port={$db['port']}", "--username={$db['username']}", $db['database']],
                    null, ['PGPASSWORD' => (string) $db['password']],
                );
                break;
            case 'mysql':
            case 'mariadb':
                $file = "{$base}.sql";
                $process = new Process(
                    ['mysqldump', '--single-transaction', '--routines', "--host={$db['host']}", "--port={$db['port']}", "--user={$db['username']}", "--result-file={$file}", $db['database']],
                    null, ['MYSQL_PWD' => (string) $db['password']],
                );
                break;
            case 'sqlite':
                $file = "{$base}.sqlite";
                return is_file($db['database']) && copy($db['database'], $file) ? $file : null;
            default:
                $this->error("No backup tool for the {$db['driver']} database.");
                return null;
        }

        $process->setTimeout(3600);
        $process->run();
        if (! $process->isSuccessful() || ! is_file($file) || filesize($file) === 0) {
            $this->error(trim($process->getErrorOutput()) ?: 'The backup tool exited without writing a backup.');
            return null;
        }
        return $file;
    }

    private function wipe(array $tables): void
    {
        $has = fn (string $table) => in_array($table, $tables, true);

        $fiscalRegisterIds = $has('fiscal_devices') ? DB::table('fiscal_devices')->pluck('register_id')->all() : [];
        if ($has('registers') && Schema::hasColumn('registers', 'gofiscal_device_id')) {
            $fiscalRegisterIds = array_merge($fiscalRegisterIds, DB::table('registers')->whereNotNull('gofiscal_device_id')->pluck('id')->all());
        }
        $fiscalBranchIds = $fiscalRegisterIds ? DB::table('registers')->whereIn('id', $fiscalRegisterIds)->pluck('branch_id')->all() : [];
        $mappedTaxRateIds = $has('fiscal_tax_mappings') ? DB::table('fiscal_tax_mappings')->whereNotNull('local_tax_rate_id')->pluck('local_tax_rate_id')->all() : [];

        $this->partial = [
            'settings' => function (Builder $q) {
                foreach (self::KEEP_SETTING_PREFIXES as $prefix) {
                    $q->where('key', 'not like', $prefix . '%');
                }
                return $q;
            },
            'registers' => fn (Builder $q) => $q->whereNotIn('id', $fiscalRegisterIds),
            'branches' => fn (Builder $q) => $q->whereNotIn('id', $fiscalBranchIds),
            'tax_rates' => fn (Builder $q) => $q->whereNotIn('id', $mappedTaxRateIds),
        ];

        $erase = array_values(array_diff($tables, self::KEEP_TABLES));
        $foreignKeys = [];
        foreach ($tables as $table) {
            $foreignKeys[$table] = array_values(array_filter(Schema::getForeignKeys($table), fn ($fk) => count($fk['columns']) === 1));
        }

        // Whatever survives mustn't be left pointing at a row that's going.
        foreach ($tables as $table) {
            $survivors = $this->survivors($table, $erase);
            if ($survivors === null) {
                continue;
            }
            foreach ($foreignKeys[$table] as $fk) {
                if (! in_array($fk['foreign_table'], $erase, true)) {
                    continue;
                }
                $column = $fk['columns'][0];
                $dangling = (clone $survivors)->whereNotNull($column)
                    ->whereIn($column, $this->rowsToErase($fk['foreign_table'])->select($fk['foreign_columns'][0]));
                if (! $dangling->exists()) {
                    continue;
                }
                if (! $this->nullable($table, $column)) {
                    throw new RuntimeException("Kept rows in {$table} need {$fk['foreign_table']} rows that would be erased ({$column}). Nothing was changed.");
                }
                $dangling->update([$column => null]);
            }
        }

        // Children before the rows they point at; a ring of tables pointing at
        // each other is broken by clearing a nullable link first.
        $pending = $erase;
        while ($pending) {
            $referenced = [];
            foreach ($pending as $table) {
                foreach ($foreignKeys[$table] as $fk) {
                    if ($fk['foreign_table'] !== $table && in_array($fk['foreign_table'], $pending, true)) {
                        $referenced[$fk['foreign_table']] = true;
                    }
                }
            }
            $ready = array_values(array_filter($pending, fn ($t) => ! isset($referenced[$t])));
            if ($ready) {
                foreach ($ready as $table) {
                    $this->rowsToErase($table)->delete();
                }
                $pending = array_values(array_diff($pending, $ready));
                continue;
            }

            $broken = false;
            foreach ($pending as $table) {
                foreach ($foreignKeys[$table] as $i => $fk) {
                    if ($fk['foreign_table'] === $table || ! in_array($fk['foreign_table'], $pending, true) || ! $this->nullable($table, $fk['columns'][0])) {
                        continue;
                    }
                    $this->rowsToErase($table)->update([$fk['columns'][0] => null]);
                    unset($foreignKeys[$table][$i]);
                    $broken = true;
                }
            }
            if (! $broken) {
                throw new RuntimeException('These tables point at each other and can\'t be emptied: ' . implode(', ', $pending) . '. Nothing was changed.');
            }
        }
    }

    /** The rows of $table that go — all of them, unless it's only partly erased. */
    private function rowsToErase(string $table): Builder
    {
        $query = DB::table($table);
        return isset($this->partial[$table]) ? ($this->partial[$table])($query) : $query;
    }

    /** The rows of $table that stay, or null when none do. */
    private function survivors(string $table, array $erase): ?Builder
    {
        if (! in_array($table, $erase, true)) {
            return DB::table($table);
        }
        if (! isset($this->partial[$table])) {
            return null;
        }
        return DB::table($table)->whereNot(fn ($q) => ($this->partial[$table])($q));
    }

    private function nullable(string $table, string $column): bool
    {
        foreach (Schema::getColumns($table) as $info) {
            if ($info['name'] === $column) {
                return (bool) $info['nullable'];
            }
        }
        return false;
    }

    private function startOver(string $name, string $username, ?string $email, string $password): void
    {
        // A branch to work in — the ZIMRA device's, if one was kept
        $branch = Branch::where('is_main', true)->first() ?? Branch::first();
        if (! $branch) {
            $branch = Branch::create(['name' => 'Main Branch', 'code' => 'MAIN', 'currency' => 'USD', 'is_main' => true, 'is_active' => true]);
        } elseif (! $branch->is_main) {
            $branch->update(['is_main' => true]);
        }
        foreach (Branch::all() as $each) {
            Warehouse::create([
                'name' => $each->is($branch) ? 'Main Warehouse' : "{$each->name} Warehouse",
                'code' => 'WH-' . $each->code, 'branch_id' => $each->id, 'is_default' => true, 'is_active' => true,
            ]);
        }

        $role = Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web']);
        if ($role->wasRecentlyCreated) {
            $role->syncPermissions(Permission::all());
        }
        User::create([
            'name' => $name ?: 'Administrator', 'username' => $username, 'email' => $email,
            'password' => $password, 'branch_id' => $branch->id, 'is_active' => true,
        ])->assignRole($role);

        (new ReferenceDataSeeder())->run();
        Setting::set('data_reset_at', now()->toIso8601String(), 'system');

        // Setting the new system up isn't business activity — the audit log starts empty.
        if (Schema::hasTable('audit_logs')) {
            DB::table('audit_logs')->delete();
        }
    }
}
