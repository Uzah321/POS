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
use Illuminate\Support\Facades\Hash;
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
        Role::findByName('cashier')->syncPermissions(['create_sales']);
        Role::findByName('storekeeper')->syncPermissions(['view_dashboard','view_inventory','manage_inventory','adjust_stock','transfer_stock','view_products','manage_products','view_purchase_orders','receive_goods']);
        Role::findByName('accountant')->syncPermissions(['view_dashboard','view_sales','view_reports','view_financial_reports','view_expenses','manage_expenses','approve_expenses']);

        // Main branch
        $branch = Branch::firstOrCreate(['code' => 'MAIN'], ['name'=>'Main Branch','code'=>'MAIN','address'=>'123 Main Street','city'=>'Johannesburg','phone'=>'+27 11 000 0000','email'=>'main@bottlestore.co.za','currency'=>'USD','is_main'=>true,'is_active'=>true]);

        // Default warehouse
        Warehouse::firstOrCreate(['code' => 'WH-MAIN'], ['name'=>'Main Warehouse','code'=>'WH-MAIN','branch_id'=>$branch->id,'is_default'=>true,'is_active'=>true]);

        // Users
        $admin = User::firstOrCreate(['email'=>'admin@bottlestore.co.za'],['name'=>'System Admin','username'=>'admin','password'=>Hash::make('Admin@123'),'branch_id'=>$branch->id,'is_active'=>true]);
        if (!$admin->username) { $admin->update(['username' => 'admin']); }
        $admin->syncRoles(['admin']);
        $manager = User::firstOrCreate(['email'=>'manager@bottlestore.co.za'],['name'=>'Store Manager','username'=>'manager','password'=>Hash::make('Manager@123'),'branch_id'=>$branch->id,'is_active'=>true]);
        if (!$manager->username) { $manager->update(['username' => 'manager']); }
        $manager->syncRoles(['manager']);
        $cashier = User::firstOrCreate(['email'=>'cashier@bottlestore.co.za'],['name'=>'John Cashier','username'=>'cashier1','password'=>Hash::make('Cashier@123'),'branch_id'=>$branch->id,'is_active'=>true]);
        if (!$cashier->username) { $cashier->update(['username' => 'cashier1']); }
        $cashier->syncRoles(['cashier']);

        // Tax rates
        TaxRate::firstOrCreate(['name'=>'Standard VAT (15%)'],['rate'=>15,'is_default'=>true,'is_active'=>true]);
        TaxRate::firstOrCreate(['name'=>'Zero Rated (0%)'],['rate'=>0,'is_default'=>false,'is_active'=>true]);

        // Currencies (USD as default)
        $currencies = [
            ['code'=>'USD','name'=>'US Dollar',          'symbol'=>'$',   'exchange_rate'=>1.000000, 'is_default'=>true],
            ['code'=>'ZAR','name'=>'South African Rand', 'symbol'=>'R',   'exchange_rate'=>18.450000],
            ['code'=>'EUR','name'=>'Euro',                'symbol'=>'€',   'exchange_rate'=>0.920000],
            ['code'=>'GBP','name'=>'British Pound',       'symbol'=>'£',   'exchange_rate'=>0.790000],
            ['code'=>'BWP','name'=>'Botswana Pula',       'symbol'=>'P',   'exchange_rate'=>13.650000],
            ['code'=>'ZMW','name'=>'Zambian Kwacha',      'symbol'=>'ZK',  'exchange_rate'=>27.500000],
            ['code'=>'NAD','name'=>'Namibian Dollar',     'symbol'=>'N$',  'exchange_rate'=>18.450000],
            ['code'=>'MWK','name'=>'Malawian Kwacha',     'symbol'=>'MK',  'exchange_rate'=>1730.000000],
            ['code'=>'KES','name'=>'Kenyan Shilling',     'symbol'=>'KSh', 'exchange_rate'=>128.500000],
            ['code'=>'NGN','name'=>'Nigerian Naira',      'symbol'=>'₦',   'exchange_rate'=>1620.000000],
        ];
        foreach ($currencies as $c) {
            Currency::firstOrCreate(['code' => $c['code']], array_merge(['is_default'=>false,'is_active'=>true], $c));
        }

        // Units
        foreach ([['Piece','pc'],['Kilogram','kg'],['Litre','l'],['Box','box'],['Carton','ctn'],['Bottle','btl'],['Can','can'],['Pack','pk']] as [$name,$abbr]) {
            Unit::firstOrCreate(['abbreviation'=>$abbr],['name'=>$name,'abbreviation'=>$abbr]);
        }

        // Categories
        $categories = [
            // Bottle store
            'Spirits', 'Wine', 'Beer & Cider', 'Mixers & Soft Drinks', 'Water', 'RTD (Ready to Drink)', 'Non-Alcoholic', 'Snacks & Food', 'Accessories', 'Tobacco',
            // Butcher
            'Fresh Meat', 'Poultry', 'Seafood', 'Deli & Cold Cuts', 'Frozen Meat',
            // Supermarket
            'Dairy & Eggs', 'Bread & Bakery', 'Fruit & Vegetables', 'Canned Goods', 'Dry Goods & Cereals',
            'Condiments & Sauces', 'Cleaning & Household', 'Personal Care', 'Confectionery', 'Frozen Foods',
            'Baby Products', 'Pet Food',
        ];
        foreach ($categories as $name) {
            Category::firstOrCreate(['slug'=>\Illuminate\Support\Str::slug($name)],['name'=>$name,'slug'=>\Illuminate\Support\Str::slug($name),'is_active'=>true]);
        }

        // Brands
        $brands = [
            'Heineken', 'Castle Lager', 'Jack Daniels', 'Jameson', 'Johnnie Walker', 'Savanna', 'Brutal Fruit', 'Amarula', 'J&B', 'Smirnoff',
            'Clover', 'Parmalat', 'Tiger Brands', 'Koo', 'Lucky Star', 'Sasko', 'Tastic', 'Omo', 'Sunlight', 'Cadbury', 'Pedigree',
            'Pick n Pay', 'Woolworths', 'Checkers', 'Shoprite',
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
            ['company_name','Bottlestore','company'],
            ['company_address','123 Main Street, Johannesburg','company'],
            ['company_phone','+27 11 000 0000','company'],
            ['company_email','info@bottlestore.co.za','company'],
            ['company_vat_number','4123456789','company'],
            ['currency','USD','pos'],
            ['currency_symbol','$','pos'],
            ['default_currency','USD','pos'],
            ['loyalty_points_rate','10','pos'],
            ['receipt_footer','Thank you for shopping with us!','pos'],
            ['low_stock_threshold','5','inventory'],
            ['multi_currency_enabled','true','pos'],
        ] as [$key,$value,$group]) {
            Setting::firstOrCreate(['key'=>$key],['key'=>$key,'value'=>$value,'group'=>$group]);
        }

        $this->command->info('Seeded! Login: admin@bottlestore.co.za / Admin@123');
        $this->call(TestDataSeeder::class);
    }
}
