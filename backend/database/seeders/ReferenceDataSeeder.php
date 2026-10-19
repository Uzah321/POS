<?php

namespace Database\Seeders;

use App\Models\Currency;
use App\Models\ExpenseCategory;
use App\Models\Setting;
use App\Models\TaxRate;
use App\Models\Unit;
use Illuminate\Database\Seeder;

/**
 * The reference lists every install starts with — tax rates, currencies,
 * units, expense categories and neutral till defaults — without any demo
 * branch, users, products or company details. Run by DatabaseSeeder for a
 * new install, and by system:factory-reset to start over.
 */
class ReferenceDataSeeder extends Seeder
{
    public function run(): void
    {
        // Tax rates — only when there are none (a factory reset keeps the
        // ones ZIMRA's tax mappings point at)
        if (TaxRate::count() === 0) {
            TaxRate::create(['name' => 'Standard VAT (15%)', 'rate' => 15, 'is_default' => true, 'is_active' => true]);
            TaxRate::create(['name' => 'Zero Rated (0%)', 'rate' => 0, 'is_default' => false, 'is_active' => true]);
        }

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

        // Expense categories
        foreach (['Rent','Utilities','Salaries','Marketing','Maintenance','Transport','Office Supplies','Miscellaneous'] as $name) {
            ExpenseCategory::firstOrCreate(['name'=>$name],['name'=>$name,'is_active'=>true]);
        }

        // Till defaults
        foreach ([
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
    }
}
