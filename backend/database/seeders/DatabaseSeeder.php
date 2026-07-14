<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\Category;
use App\Models\Brand;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Models\Warehouse;
use App\Models\User;
use App\Models\Setting;
use App\Models\ExpenseCategory;
use App\Models\Currency;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Role;
use Spatie\Permission\Models\Permission;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // Roles
        $roles = ['admin', 'manager', 'cashier', 'storekeeper', 'accountant'];
        foreach ($roles as $role) {
            Role::firstOrCreate(['name' => $role, 'guard_name' => 'web']);
        }

        // Permissions
        $permissions = [
            'view_dashboard', 'manage_users',
            'view_sales', 'create_sales', 'void_sales', 'process_refunds',
            'view_products', 'manage_products',
            'view_inventory', 'manage_inventory', 'adjust_stock', 'transfer_stock',
            'view_suppliers', 'manage_suppliers',
            'view_purchase_orders', 'manage_purchase_orders', 'approve_purchase_orders', 'receive_goods',
            'view_customers', 'manage_customers',
            'view_expenses', 'manage_expenses', 'approve_expenses',
            'view_reports', 'view_financial_reports',
            'manage_branches', 'manage_settings',
            'view_audit_logs',
        ];

        foreach ($permissions as $perm) {
            Permission::firstOrCreate(['name' => $perm, 'guard_name' => 'web']);
        }

        Role::findByName('admin')->syncPermissions(Permission::all());
        Role::findByName('manager')->syncPermissions(['view_dashboard','view_sales','create_sales','void_sales','process_refunds','view_products','manage_products','view_inventory','manage_inventory','adjust_stock','transfer_stock','view_suppliers','view_purchase_orders','manage_purchase_orders','approve_purchase_orders','receive_goods','view_customers','manage_customers','view_expenses','manage_expenses','view_reports','view_financial_reports']);
        Role::findByName('cashier')->syncPermissions(['create_sales', 'void_sales']);
        Role::findByName('storekeeper')->syncPermissions(['view_dashboard','view_inventory','manage_inventory','adjust_stock','transfer_stock','view_products','manage_products','view_purchase_orders','receive_goods']);
        Role::findByName('accountant')->syncPermissions(['view_dashboard','view_sales','view_reports','view_financial_reports','view_expenses','manage_expenses','approve_expenses']);

        // Main branch
        $branch = Branch::firstOrCreate(['code' => 'MAIN'], ['name'=>'Main Branch','code'=>'MAIN','address'=>'123 Main Street','city'=>'Johannesburg','phone'=>'+27 11 000 0000','email'=>'main@corepos.local','currency'=>'USD','is_main'=>true,'is_active'=>true]);

        // Default warehouse
        Warehouse::firstOrCreate(['code' => 'WH-MAIN'], ['name'=>'Main Warehouse','code'=>'WH-MAIN','branch_id'=>$branch->id,'is_default'=>true,'is_active'=>true]);

        // Users
        $admin = User::firstOrCreate(['email'=>'admin@corepos.local'],['name'=>'System Admin','username'=>'admin','password'=>'Admin@123','branch_id'=>$branch->id,'is_active'=>true]);
        if (!$admin->username) { $admin->update(['username' => 'admin']); }
        $admin->syncRoles(['admin']);
        $manager = User::firstOrCreate(['email'=>'manager@corepos.local'],['name'=>'Store Manager','username'=>'manager','password'=>'Manager@123','branch_id'=>$branch->id,'is_active'=>true]);
        if (!$manager->username) { $manager->update(['username' => 'manager']); }
        $manager->syncRoles(['manager']);
        $cashier = User::firstOrCreate(['email'=>'cashier@corepos.local'],['name'=>'John Cashier','username'=>'cashier1','password'=>'Cashier@123','branch_id'=>$branch->id,'is_active'=>true]);
        if (!$cashier->username) { $cashier->update(['username' => 'cashier1']); }
        $cashier->syncRoles(['cashier']);

        // Tax rates
        TaxRate::firstOrCreate(['name'=>'Standard VAT (15%)'],['rate'=>15,'is_default'=>true,'is_active'=>true]);
        TaxRate::firstOrCreate(['name'=>'Zero Rated (0%)'],['rate'=>0,'is_default'=>false,'is_active'=>true]);

        // Currencies (USD as default) — trimmed to the three this store actually trades in
        $currencies = [
            ['code'=>'USD','name'=>'US Dollar',           'symbol'=>'$',   'exchange_rate'=>1.000000, 'is_default'=>true],
            ['code'=>'ZAR','name'=>'South African Rand',  'symbol'=>'R',   'exchange_rate'=>18.450000],
            ['code'=>'ZWG','name'=>'Zimbabwe Gold',       'symbol'=>'ZiG', 'exchange_rate'=>26.800000],
        ];
        foreach ($currencies as $c) {
            Currency::firstOrCreate(['code' => $c['code']], array_merge(['is_default'=>false,'is_active'=>true], $c));
        }

        // Units
        foreach ([['Piece','pc'],['Kilogram','kg'],['Litre','l'],['Box','box'],['Carton','ctn'],['Bottle','btl'],['Can','can'],['Pack','pk']] as [$name,$abbr]) {
            Unit::firstOrCreate(['abbreviation'=>$abbr],['name'=>$name,'abbreviation'=>$abbr]);
        }

        // Categories — a lean set covering bottle store, butcher, and supermarket
        // (kept small on purpose so the POS grid stays easy to test with)
        $categories = [
            'Spirits', 'Wine', 'Beer & Cider', 'Mixers & Soft Drinks',
            'Fresh Meat', 'Dairy & Eggs', 'Bread & Bakery', 'Fruit & Vegetables',
            'Cleaning & Household', 'Confectionery',
        ];
        foreach ($categories as $name) {
            Category::firstOrCreate(['slug'=>\Illuminate\Support\Str::slug($name)],['name'=>$name,'slug'=>\Illuminate\Support\Str::slug($name),'is_active'=>true]);
        }

        // Brands — trimmed to only what the reduced product list references
        $brands = [
            'Heineken', 'Castle Lager', 'Jack Daniels', 'Amarula', 'Smirnoff',
            'Clover', 'Sasko', 'Sunlight', 'Cadbury',
            'Pick n Pay', 'Woolworths', 'Shoprite',
        ];
        foreach ($brands as $name) {
            Brand::firstOrCreate(['slug'=>\Illuminate\Support\Str::slug($name)],['name'=>$name,'slug'=>\Illuminate\Support\Str::slug($name),'is_active'=>true]);
        }

        // Expense categories
        foreach (['Rent','Utilities','Salaries','Marketing','Maintenance','Transport','Office Supplies','Miscellaneous'] as $name) {
            ExpenseCategory::firstOrCreate(['name'=>$name],['name'=>$name,'is_active'=>true]);
        }

        // Settings
        foreach ([
            ['company_name','Core','company'],
            ['company_address','123 Main Street, Johannesburg','company'],
            ['company_phone','+27 11 000 0000','company'],
            ['company_email','info@corepos.local','company'],
            ['company_vat_number','4123456789','company'],
            ['currency','USD','pos'],
            ['currency_symbol','$','pos'],
            ['default_currency','USD','pos'],
            ['loyalty_points_rate','10','pos'],
            ['receipt_footer','Thank you for shopping with us!','pos'],
            ['low_stock_threshold','5','inventory'],
            ['multi_currency_enabled','true','pos'],
            ['business_type','restaurant','company'],
        ] as [$key,$value,$group]) {
            Setting::firstOrCreate(['key'=>$key],['key'=>$key,'value'=>$value,'group'=>$group]);
        }

        $this->command->info('Seeded! Login: admin@corepos.local / Admin@123');

        if (! app()->environment('production')) {
            $this->call(TestDataSeeder::class);
        }
    }
}
