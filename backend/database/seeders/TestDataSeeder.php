<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SalePayment;
use App\Models\Stock;
use App\Models\Supplier;
use App\Models\TaxRate;
use App\Models\Unit;
use App\Models\User;
use App\Models\Warehouse;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class TestDataSeeder extends Seeder
{
    public function run(): void
    {
        $branch    = Branch::where('code', 'MAIN')->first();
        $warehouse = Warehouse::where('code', 'WH-MAIN')->first();
        $admin     = User::where('email', 'admin@corepos.local')->first();
        $cashier   = User::where('email', 'cashier@corepos.local')->first();
        $vatRate   = TaxRate::where('is_default', true)->first();
        $zeroRate  = TaxRate::where('rate', 0)->first();

        // ── SUPPLIERS ─────────────────────────────────────────────────────────
        $suppliers = $this->seedSuppliers($branch);

        // ── PRODUCTS ──────────────────────────────────────────────────────────
        $products = $this->seedProducts($vatRate, $zeroRate);

        // ── INITIAL STOCK ─────────────────────────────────────────────────────
        $this->seedStock($products, $warehouse);

        // ── CUSTOMERS ─────────────────────────────────────────────────────────
        $customers = $this->seedCustomers($branch);

        // ── SALES (last 30 days) ──────────────────────────────────────────────
        $this->seedSales($branch, $warehouse, $cashier, $admin, $products, $customers);

        // ── EXPENSES (last 30 days) ───────────────────────────────────────────
        $this->seedExpenses($branch, $admin);

        $this->command->info('Test data seeded successfully!');
    }

    // ─────────────────────────────────────────────────────────────────────────
    private function seedSuppliers(Branch $branch): array
    {
        $data = [
            ['company_name' => 'Diageo South Africa',    'name' => 'Sipho Nkosi',    'email' => 'sipho@diageo.co.za',   'phone' => '+27 11 555 0001', 'address' => '10 Industrial Ave, Johannesburg', 'city' => 'Johannesburg'],
            ['company_name' => 'SAB Miller Beverages',   'name' => 'Thandi Mokoena', 'email' => 'thandi@sab.co.za',     'phone' => '+27 11 555 0002', 'address' => '5 Brewery Road, Johannesburg',    'city' => 'Johannesburg'],
            ['company_name' => 'DGB Fine Wines',          'name' => 'Piet van Wyk',   'email' => 'piet@dgb.co.za',       'phone' => '+27 21 555 0003', 'address' => '22 Wine Estate Road, Paarl',      'city' => 'Paarl'],
            ['company_name' => 'Distell Group',           'name' => 'Zanele Dube',    'email' => 'zanele@distell.co.za', 'phone' => '+27 21 555 0004', 'address' => '1 Adam Tas Road, Stellenbosch',   'city' => 'Stellenbosch'],
            ['company_name' => 'National Liquor Traders', 'name' => 'Ahmed Patel',    'email' => 'ahmed@nlt.co.za',      'phone' => '+27 31 555 0005', 'address' => '100 Harbor Road, Durban',         'city' => 'Durban'],
        ];

        $result = [];
        foreach ($data as $d) {
            $result[] = Supplier::firstOrCreate(
                ['email' => $d['email']],
                array_merge($d, ['is_active' => true, 'balance' => 0])
            );
        }
        return $result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    private function seedProducts(TaxRate $vatRate, TaxRate $zeroRate): array
    {
        $categories = Category::pluck('id', 'name');
        $brands     = Brand::pluck('id', 'name');
        $units      = Unit::pluck('id', 'abbreviation');

        $btlUnit = $units['btl'] ?? $units['pc'];
        $canUnit = $units['can'] ?? $units['pc'];
        $pkUnit  = $units['pk'] ?? $units['pc'];
        $lUnit   = $units['l'] ?? $units['pc'];
        $kgUnit  = $units['kg'] ?? $units['pc'];
        $pcUnit  = $units['pc'] ?? $units['btl'];

        // All prices in USD
        $productsData = [
            // ── Spirits ──────────────────────────────────────────────────────
            ['name' => "Jack Daniel's Old No.7 750ml",  'sku' => 'JD-750',    'barcode' => '5000140204014', 'category' => 'Spirits',              'brand' => 'Jack Daniels',    'cost' => 14.50, 'price' => 22.99,  'wholesale' => 20.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],
            ['name' => "Jack Daniel's Old No.7 1L",     'sku' => 'JD-1L',     'barcode' => '5000140204021', 'category' => 'Spirits',              'brand' => 'Jack Daniels',    'cost' => 18.00, 'price' => 29.99,  'wholesale' => 27.00, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 6],
            ['name' => 'Jameson Irish Whiskey 750ml',   'sku' => 'JMN-750',   'barcode' => '5011007003234', 'category' => 'Spirits',              'brand' => 'Jameson',         'cost' => 13.00, 'price' => 21.99,  'wholesale' => 19.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],
            ['name' => 'Johnnie Walker Black 750ml',    'sku' => 'JWB-750',   'barcode' => '5000267024691', 'category' => 'Spirits',              'brand' => 'Johnnie Walker',  'cost' => 16.00, 'price' => 26.99,  'wholesale' => 24.00, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],
            ['name' => 'Johnnie Walker Red Label 750ml','sku' => 'JWR-750',   'barcode' => '5000267023588', 'category' => 'Spirits',              'brand' => 'Johnnie Walker',  'cost' => 10.00, 'price' => 17.99,  'wholesale' => 15.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 24],
            ['name' => 'Smirnoff Vodka 1L',             'sku' => 'SMR-1L',    'barcode' => '5000281010212', 'category' => 'Spirits',              'brand' => 'Smirnoff',        'cost' => 9.50,  'price' => 16.99,  'wholesale' => 14.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 24],
            ['name' => "Gordon's Gin 750ml",            'sku' => 'GRD-750',   'barcode' => '5000289905022', 'category' => 'Spirits',              'brand' => 'Smirnoff',        'cost' => 8.00,  'price' => 14.99,  'wholesale' => 12.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],
            ['name' => 'Amarula Cream 750ml',           'sku' => 'AMR-750',   'barcode' => '6001253001026', 'category' => 'Spirits',              'brand' => 'Amarula',         'cost' => 7.50,  'price' => 13.99,  'wholesale' => 12.00, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],
            ['name' => "J&B Rare Whisky 750ml",         'sku' => 'JNB-750',   'barcode' => '5000267023717', 'category' => 'Spirits',              'brand' => 'J&B',             'cost' => 9.00,  'price' => 15.99,  'wholesale' => 14.00, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],

            // ── Wine ─────────────────────────────────────────────────────────
            ['name' => 'Durbanville Hills Sauvignon Blanc 750ml', 'sku' => 'DHB-SB-750', 'barcode' => '6001148001017', 'category' => 'Wine', 'brand' => 'Smirnoff', 'cost' => 4.50, 'price' => 8.99,  'wholesale' => 7.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 24],
            ['name' => 'Boschendal Shiraz 750ml',               'sku' => 'BSH-SHZ-750', 'barcode' => '6001148002014', 'category' => 'Wine', 'brand' => 'Smirnoff', 'cost' => 5.00, 'price' => 9.99,  'wholesale' => 8.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 24],
            ['name' => 'Two Oceans Cabernet 750ml',             'sku' => 'TOC-CAB-750', 'barcode' => '6001148003011', 'category' => 'Wine', 'brand' => 'Smirnoff', 'cost' => 3.50, 'price' => 6.99,  'wholesale' => 5.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 36],
            ['name' => 'Nederburg Stein 750ml',                 'sku' => 'NDB-STN-750', 'barcode' => '6001148004018', 'category' => 'Wine', 'brand' => 'Smirnoff', 'cost' => 3.00, 'price' => 5.99,  'wholesale' => 4.75, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 36],

            // ── Beer & Cider ──────────────────────────────────────────────────
            ['name' => 'Heineken 330ml (6-Pack)',    'sku' => 'HNK-6PK',  'barcode' => '8712000046582', 'category' => 'Beer & Cider', 'brand' => 'Heineken',       'cost' => 5.50, 'price' => 9.99,  'wholesale' => 8.50, 'unit' => $pkUnit,  'tax' => $vatRate, 'reorder' => 48],
            ['name' => 'Heineken 500ml Can',         'sku' => 'HNK-500C', 'barcode' => '8712000034503', 'category' => 'Beer & Cider', 'brand' => 'Heineken',       'cost' => 1.00, 'price' => 1.99,  'wholesale' => 1.65, 'unit' => $canUnit, 'tax' => $vatRate, 'reorder' => 120],
            ['name' => 'Castle Lager 340ml (6-Pack)','sku' => 'CSL-6PK',  'barcode' => '6001007000013', 'category' => 'Beer & Cider', 'brand' => 'Castle Lager',   'cost' => 4.50, 'price' => 7.99,  'wholesale' => 6.75, 'unit' => $pkUnit,  'tax' => $vatRate, 'reorder' => 48],
            ['name' => 'Castle Lager 330ml Can',     'sku' => 'CSL-330C', 'barcode' => '6001007000020', 'category' => 'Beer & Cider', 'brand' => 'Castle Lager',   'cost' => 0.75, 'price' => 1.49,  'wholesale' => 1.25, 'unit' => $canUnit, 'tax' => $vatRate, 'reorder' => 240],
            ['name' => 'Savanna Dry 330ml (6-Pack)', 'sku' => 'SVD-6PK',  'barcode' => '6001007001010', 'category' => 'Beer & Cider', 'brand' => 'Savanna',        'cost' => 5.00, 'price' => 8.99,  'wholesale' => 7.50, 'unit' => $pkUnit,  'tax' => $vatRate, 'reorder' => 36],
            ['name' => 'Brutal Fruit Ruby Apple Can','sku' => 'BRF-RA',   'barcode' => '6001007002017', 'category' => 'RTD (Ready to Drink)', 'brand' => 'Brutal Fruit', 'cost' => 0.90, 'price' => 1.79, 'wholesale' => 1.49, 'unit' => $canUnit, 'tax' => $vatRate, 'reorder' => 120],

            // ── Mixers & Soft Drinks ──────────────────────────────────────────
            ['name' => 'Schweppes Tonic Water 500ml', 'sku' => 'SWP-TWR-500', 'barcode' => '5000112659223', 'category' => 'Mixers & Soft Drinks', 'brand' => 'Heineken', 'cost' => 0.45, 'price' => 0.99,  'wholesale' => 0.79, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 48],
            ['name' => 'Coca-Cola 2L',                'sku' => 'CCA-2L',      'barcode' => '5449000000996', 'category' => 'Mixers & Soft Drinks', 'brand' => 'Heineken', 'cost' => 0.60, 'price' => 1.29,  'wholesale' => 1.05, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 48],
            ['name' => 'Red Bull Energy 250ml',       'sku' => 'RBL-250',     'barcode' => '9002490100070', 'category' => 'Mixers & Soft Drinks', 'brand' => 'Heineken', 'cost' => 0.90, 'price' => 1.89,  'wholesale' => 1.55, 'unit' => $canUnit, 'tax' => $vatRate, 'reorder' => 48],

            // ── Water ─────────────────────────────────────────────────────────
            ['name' => 'Aquelle Still Water 500ml (6-Pack)', 'sku' => 'AQL-6PK', 'barcode' => '6009880001011', 'category' => 'Water', 'brand' => 'Heineken', 'cost' => 1.20, 'price' => 2.49, 'wholesale' => 1.99, 'unit' => $pkUnit, 'tax' => $zeroRate, 'reorder' => 60],

            // ── Tobacco / Accessories ─────────────────────────────────────────
            ['name' => 'Marlboro Red 20s',  'sku' => 'MRL-R20', 'barcode' => '4038634002510', 'category' => 'Tobacco', 'brand' => 'Jack Daniels', 'cost' => 2.80, 'price' => 4.99, 'wholesale' => 4.50, 'unit' => $pkUnit, 'tax' => $vatRate, 'reorder' => 60],
            ['name' => 'Camel Filter 20s',  'sku' => 'CML-F20', 'barcode' => '4038634002527', 'category' => 'Tobacco', 'brand' => 'Jack Daniels', 'cost' => 2.60, 'price' => 4.75, 'wholesale' => 4.25, 'unit' => $pkUnit, 'tax' => $vatRate, 'reorder' => 60],
            ['name' => 'Corkscrew Wine Opener', 'sku' => 'ACC-CRK', 'barcode' => '0012345678905', 'category' => 'Accessories', 'brand' => 'Jack Daniels', 'cost' => 1.50, 'price' => 3.99, 'wholesale' => 2.99, 'unit' => $units['pc'] ?? $btlUnit, 'tax' => $vatRate, 'reorder' => 10],

            // ── Fresh Meat (Butcher) ──────────────────────────────────────────
            ['name' => 'Beef Mince 500g',           'sku' => 'BF-MNC-500',  'barcode' => '6009001001001', 'category' => 'Fresh Meat',         'brand' => 'Pick n Pay',   'cost' => 2.50,  'price' => 4.99,  'wholesale' => 4.25, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Beef Rump Steak 500g',      'sku' => 'BF-RST-500',  'barcode' => '6009001001002', 'category' => 'Fresh Meat',         'brand' => 'Woolworths',   'cost' => 5.00,  'price' => 8.99,  'wholesale' => 7.50, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 15],
            ['name' => 'T-Bone Steak 350g',         'sku' => 'BF-TBN-350',  'barcode' => '6009001001003', 'category' => 'Fresh Meat',         'brand' => 'Woolworths',   'cost' => 6.50,  'price' => 11.99, 'wholesale' => 10.00,'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 10],
            ['name' => 'Lamb Chops 500g',           'sku' => 'LMB-CHP-500', 'barcode' => '6009001001004', 'category' => 'Fresh Meat',         'brand' => 'Pick n Pay',   'cost' => 5.50,  'price' => 9.99,  'wholesale' => 8.50, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 10],
            ['name' => 'Boerewors 500g',            'sku' => 'BW-500',      'barcode' => '6009001001005', 'category' => 'Fresh Meat',         'brand' => 'Pick n Pay',   'cost' => 3.00,  'price' => 5.49,  'wholesale' => 4.75, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Pork Ribs 1kg',             'sku' => 'PRK-RBS-1KG', 'barcode' => '6009001001006', 'category' => 'Fresh Meat',         'brand' => 'Checkers',     'cost' => 5.00,  'price' => 8.49,  'wholesale' => 7.25, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 10],

            // ── Poultry ───────────────────────────────────────────────────────
            ['name' => 'Whole Chicken 1.8kg',       'sku' => 'CHK-WHL-18',  'barcode' => '6009001002001', 'category' => 'Poultry',            'brand' => 'Tiger Brands', 'cost' => 4.50,  'price' => 7.99,  'wholesale' => 6.75, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Chicken Braai Pack 1.5kg',  'sku' => 'CHK-BRP-15',  'barcode' => '6009001002002', 'category' => 'Poultry',            'brand' => 'Tiger Brands', 'cost' => 3.50,  'price' => 6.49,  'wholesale' => 5.50, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Chicken Breast Fillets 1kg','sku' => 'CHK-BRF-1KG', 'barcode' => '6009001002003', 'category' => 'Poultry',            'brand' => 'Woolworths',   'cost' => 4.00,  'price' => 7.49,  'wholesale' => 6.25, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 15],

            // ── Deli & Cold Cuts ──────────────────────────────────────────────
            ['name' => 'Sliced Salami 150g',        'sku' => 'SLM-150',     'barcode' => '6009001003001', 'category' => 'Deli & Cold Cuts',   'brand' => 'Woolworths',   'cost' => 2.00,  'price' => 3.49,  'wholesale' => 2.99, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 12],
            ['name' => 'Smoked Pork Neck 500g',     'sku' => 'PKN-SMK-500', 'barcode' => '6009001003002', 'category' => 'Deli & Cold Cuts',   'brand' => 'Pick n Pay',   'cost' => 3.50,  'price' => 5.99,  'wholesale' => 5.00, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 10],
            ['name' => 'Gammon Slices 200g',        'sku' => 'GMN-200',     'barcode' => '6009001003003', 'category' => 'Deli & Cold Cuts',   'brand' => 'Woolworths',   'cost' => 2.50,  'price' => 4.49,  'wholesale' => 3.75, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 12],

            // ── Seafood ───────────────────────────────────────────────────────
            ['name' => 'Fresh Hake Fillet 500g',    'sku' => 'SEA-HAK-500', 'barcode' => '6009001004001', 'category' => 'Seafood',            'brand' => 'Pick n Pay',   'cost' => 3.50,  'price' => 6.49,  'wholesale' => 5.50, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 10],
            ['name' => 'Tiger Prawns 500g',         'sku' => 'SEA-PRW-500', 'barcode' => '6009001004002', 'category' => 'Seafood',            'brand' => 'Woolworths',   'cost' => 6.00,  'price' => 10.99, 'wholesale' => 9.25, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 8],

            // ── Dairy & Eggs ──────────────────────────────────────────────────
            ['name' => 'Full Cream Milk 2L',        'sku' => 'MLK-FC-2L',   'barcode' => '6009001005001', 'category' => 'Dairy & Eggs',       'brand' => 'Clover',       'cost' => 1.20,  'price' => 2.19,  'wholesale' => 1.89, 'unit' => $lUnit,  'tax' => $zeroRate, 'reorder' => 50],
            ['name' => 'Cheddar Cheese 400g',       'sku' => 'CHS-CHD-400', 'barcode' => '6009001005002', 'category' => 'Dairy & Eggs',       'brand' => 'Clover',       'cost' => 2.50,  'price' => 4.49,  'wholesale' => 3.75, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Butter 500g',               'sku' => 'BTR-500',     'barcode' => '6009001005003', 'category' => 'Dairy & Eggs',       'brand' => 'Parmalat',     'cost' => 2.00,  'price' => 3.49,  'wholesale' => 2.99, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Free Range Eggs 12-pack',   'sku' => 'EGG-12PK',    'barcode' => '6009001005004', 'category' => 'Dairy & Eggs',       'brand' => 'Woolworths',   'cost' => 1.80,  'price' => 3.29,  'wholesale' => 2.75, 'unit' => $pkUnit, 'tax' => $zeroRate, 'reorder' => 30],

            // ── Bread & Bakery ────────────────────────────────────────────────
            ['name' => 'White Bread 700g',          'sku' => 'BRD-WHT-700', 'barcode' => '6009001006001', 'category' => 'Bread & Bakery',     'brand' => 'Sasko',        'cost' => 0.70,  'price' => 1.29,  'wholesale' => 1.05, 'unit' => $pcUnit, 'tax' => $zeroRate, 'reorder' => 40],
            ['name' => 'Brown Bread 700g',          'sku' => 'BRD-BRN-700', 'barcode' => '6009001006002', 'category' => 'Bread & Bakery',     'brand' => 'Sasko',        'cost' => 0.75,  'price' => 1.39,  'wholesale' => 1.15, 'unit' => $pcUnit, 'tax' => $zeroRate, 'reorder' => 40],
            ['name' => 'Sliced Bread Rolls 6-pack', 'sku' => 'BRD-RLS-6PK', 'barcode' => '6009001006003', 'category' => 'Bread & Bakery',    'brand' => 'Shoprite',     'cost' => 0.60,  'price' => 1.09,  'wholesale' => 0.89, 'unit' => $pkUnit, 'tax' => $zeroRate, 'reorder' => 30],

            // ── Fruit & Vegetables ────────────────────────────────────────────
            ['name' => 'Tomatoes 1kg',              'sku' => 'VEG-TOM-1KG', 'barcode' => '6009001007001', 'category' => 'Fruit & Vegetables', 'brand' => 'Pick n Pay',   'cost' => 0.60,  'price' => 1.19,  'wholesale' => 0.99, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 30],
            ['name' => 'Potatoes 2kg',              'sku' => 'VEG-POT-2KG', 'barcode' => '6009001007002', 'category' => 'Fruit & Vegetables', 'brand' => 'Pick n Pay',   'cost' => 0.80,  'price' => 1.49,  'wholesale' => 1.25, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 30],
            ['name' => 'Apples 1.5kg',              'sku' => 'FRT-APL-15',  'barcode' => '6009001007003', 'category' => 'Fruit & Vegetables', 'brand' => 'Woolworths',   'cost' => 1.00,  'price' => 1.99,  'wholesale' => 1.69, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 20],
            ['name' => 'Onions 1kg',                'sku' => 'VEG-ONI-1KG', 'barcode' => '6009001007004', 'category' => 'Fruit & Vegetables', 'brand' => 'Pick n Pay',   'cost' => 0.40,  'price' => 0.79,  'wholesale' => 0.65, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 30],

            // ── Canned Goods ──────────────────────────────────────────────────
            ['name' => 'Baked Beans in Sauce 410g', 'sku' => 'CAN-BBN-410', 'barcode' => '6009001008001', 'category' => 'Canned Goods',       'brand' => 'Koo',          'cost' => 0.55,  'price' => 0.99,  'wholesale' => 0.85, 'unit' => $canUnit,'tax' => $zeroRate, 'reorder' => 48],
            ['name' => 'Chopped Tomatoes 400g',     'sku' => 'CAN-TOM-400', 'barcode' => '6009001008002', 'category' => 'Canned Goods',       'brand' => 'Koo',          'cost' => 0.45,  'price' => 0.89,  'wholesale' => 0.75, 'unit' => $canUnit,'tax' => $zeroRate, 'reorder' => 48],
            ['name' => 'Tuna in Brine 170g',        'sku' => 'CAN-TNA-170', 'barcode' => '6009001008003', 'category' => 'Canned Goods',       'brand' => 'Lucky Star',   'cost' => 0.80,  'price' => 1.49,  'wholesale' => 1.25, 'unit' => $canUnit,'tax' => $zeroRate, 'reorder' => 36],

            // ── Dry Goods & Cereals ───────────────────────────────────────────
            ['name' => 'White Rice 2kg',            'sku' => 'DRY-RCE-2KG', 'barcode' => '6009001009001', 'category' => 'Dry Goods & Cereals','brand' => 'Tastic',       'cost' => 1.50,  'price' => 2.79,  'wholesale' => 2.35, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 40],
            ['name' => 'Pasta 500g',                'sku' => 'DRY-PST-500', 'barcode' => '6009001009002', 'category' => 'Dry Goods & Cereals','brand' => 'Pick n Pay',   'cost' => 0.60,  'price' => 1.09,  'wholesale' => 0.89, 'unit' => $pkUnit, 'tax' => $zeroRate, 'reorder' => 36],
            ['name' => 'Maize Meal 5kg',            'sku' => 'DRY-MZM-5KG', 'barcode' => '6009001009003', 'category' => 'Dry Goods & Cereals','brand' => 'Tiger Brands', 'cost' => 2.00,  'price' => 3.49,  'wholesale' => 2.99, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 24],

            // ── Condiments & Sauces ───────────────────────────────────────────
            ['name' => 'Sunflower Oil 2L',          'sku' => 'OIL-SFW-2L',  'barcode' => '6009001010001', 'category' => 'Condiments & Sauces','brand' => 'Pick n Pay',   'cost' => 2.50,  'price' => 4.49,  'wholesale' => 3.75, 'unit' => $lUnit,  'tax' => $zeroRate, 'reorder' => 24],
            ['name' => 'Tomato Sauce 700ml',        'sku' => 'SOS-TOM-700', 'barcode' => '6009001010002', 'category' => 'Condiments & Sauces','brand' => 'Koo',          'cost' => 0.90,  'price' => 1.69,  'wholesale' => 1.39, 'unit' => $btlUnit,'tax' => $vatRate,  'reorder' => 24],
            ['name' => 'Mayonnaise 750ml',          'sku' => 'SOS-MAY-750', 'barcode' => '6009001010003', 'category' => 'Condiments & Sauces','brand' => 'Pick n Pay',   'cost' => 1.20,  'price' => 2.19,  'wholesale' => 1.89, 'unit' => $btlUnit,'tax' => $vatRate,  'reorder' => 20],

            // ── Cleaning & Household ──────────────────────────────────────────
            ['name' => 'Washing Powder 2kg',        'sku' => 'CLN-WSP-2KG', 'barcode' => '6009001011001', 'category' => 'Cleaning & Household','brand' => 'Omo',         'cost' => 3.00,  'price' => 5.49,  'wholesale' => 4.75, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Liquid Dish Soap 750ml',    'sku' => 'CLN-DSP-750', 'barcode' => '6009001011002', 'category' => 'Cleaning & Household','brand' => 'Sunlight',    'cost' => 1.00,  'price' => 1.79,  'wholesale' => 1.49, 'unit' => $btlUnit,'tax' => $vatRate,  'reorder' => 24],
            ['name' => 'Bleach 750ml',              'sku' => 'CLN-BLC-750', 'barcode' => '6009001011003', 'category' => 'Cleaning & Household','brand' => 'Shoprite',    'cost' => 0.70,  'price' => 1.29,  'wholesale' => 1.05, 'unit' => $btlUnit,'tax' => $vatRate,  'reorder' => 20],

            // ── Personal Care ─────────────────────────────────────────────────
            ['name' => 'Shampoo 400ml',             'sku' => 'CRE-SHP-400', 'barcode' => '6009001012001', 'category' => 'Personal Care',      'brand' => 'Pick n Pay',   'cost' => 1.80,  'price' => 3.29,  'wholesale' => 2.75, 'unit' => $btlUnit,'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Toothpaste 100ml',          'sku' => 'CRE-TPT-100', 'barcode' => '6009001012002', 'category' => 'Personal Care',      'brand' => 'Pick n Pay',   'cost' => 0.90,  'price' => 1.59,  'wholesale' => 1.35, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 24],
            ['name' => 'Hand Soap Bar 3-pack',      'sku' => 'CRE-SBR-3PK', 'barcode' => '6009001012003', 'category' => 'Personal Care',      'brand' => 'Shoprite',     'cost' => 0.80,  'price' => 1.49,  'wholesale' => 1.25, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 30],

            // ── Confectionery ─────────────────────────────────────────────────
            ['name' => 'Milk Chocolate 200g',       'sku' => 'CNF-CHC-200', 'barcode' => '6009001013001', 'category' => 'Confectionery',      'brand' => 'Cadbury',      'cost' => 1.20,  'price' => 2.19,  'wholesale' => 1.89, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 30],
            ['name' => 'Wine Gums 250g',            'sku' => 'CNF-WGM-250', 'barcode' => '6009001013002', 'category' => 'Confectionery',      'brand' => 'Pick n Pay',   'cost' => 0.80,  'price' => 1.49,  'wholesale' => 1.25, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 30],
            ['name' => 'Lollipops 12-pack',         'sku' => 'CNF-LLP-12',  'barcode' => '6009001013003', 'category' => 'Confectionery',      'brand' => 'Pick n Pay',   'cost' => 0.50,  'price' => 0.99,  'wholesale' => 0.79, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 24],

            // ── Frozen Foods ──────────────────────────────────────────────────
            ['name' => 'Chicken Nuggets 1kg',       'sku' => 'FRZ-CNG-1KG', 'barcode' => '6009001014001', 'category' => 'Frozen Foods',       'brand' => 'Tiger Brands', 'cost' => 3.00,  'price' => 5.49,  'wholesale' => 4.75, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Vanilla Ice Cream 2L',      'sku' => 'FRZ-ICE-2L',  'barcode' => '6009001014002', 'category' => 'Frozen Foods',       'brand' => 'Parmalat',     'cost' => 2.50,  'price' => 4.49,  'wholesale' => 3.75, 'unit' => $lUnit,  'tax' => $vatRate,  'reorder' => 12],
            ['name' => 'Frozen Mixed Vegetables 1kg','sku' => 'FRZ-MVG-1KG','barcode' => '6009001014003', 'category' => 'Frozen Foods',       'brand' => 'Pick n Pay',   'cost' => 1.50,  'price' => 2.79,  'wholesale' => 2.35, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 20],

            // ── Baby Products ─────────────────────────────────────────────────
            ['name' => 'Baby Formula 400g',         'sku' => 'BBY-FML-400', 'barcode' => '6009001015001', 'category' => 'Baby Products',      'brand' => 'Parmalat',     'cost' => 5.00,  'price' => 8.99,  'wholesale' => 7.50, 'unit' => $pkUnit, 'tax' => $zeroRate, 'reorder' => 10],
            ['name' => 'Baby Wipes 80-pack',        'sku' => 'BBY-WPS-80',  'barcode' => '6009001015002', 'category' => 'Baby Products',      'brand' => 'Pick n Pay',   'cost' => 1.50,  'price' => 2.79,  'wholesale' => 2.35, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 15],

            // ── Pet Food ──────────────────────────────────────────────────────
            ['name' => 'Dog Food 1.5kg',            'sku' => 'PET-DGF-15',  'barcode' => '6009001016001', 'category' => 'Pet Food',           'brand' => 'Pedigree',     'cost' => 3.50,  'price' => 5.99,  'wholesale' => 5.00, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 15],
            ['name' => 'Cat Food 1kg',              'sku' => 'PET-CTF-1KG', 'barcode' => '6009001016002', 'category' => 'Pet Food',           'brand' => 'Pick n Pay',   'cost' => 2.50,  'price' => 4.49,  'wholesale' => 3.75, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 10],
        ];

        $products = [];
        foreach ($productsData as $d) {
            $catId   = $categories[$d['category']] ?? null;
            $brandId = $brands[$d['brand']] ?? null;
            $product = Product::firstOrCreate(
                ['sku' => $d['sku']],
                [
                    'name'            => $d['name'],
                    'slug'            => Str::slug($d['name']),
                    'sku'             => $d['sku'],
                    'barcode'         => $d['barcode'],
                    'category_id'     => $catId,
                    'brand_id'        => $brandId,
                    'tax_rate_id'     => $d['tax']->id,
                    'unit_id'         => $d['unit'],
                    'cost_price'      => $d['cost'],
                    'selling_price'   => $d['price'],
                    'wholesale_price' => $d['wholesale'],
                    'track_stock'     => true,
                    'is_active'       => true,
                    'has_variants'    => false,
                    'reorder_level'   => $d['reorder'],
                    'reorder_quantity'=> $d['reorder'] * 2,
                    'alert_quantity'  => max(5, (int)($d['reorder'] * 0.5)),
                ]
            );
            $products[] = $product;
        }
        return $products;
    }

    // ─────────────────────────────────────────────────────────────────────────
    private function seedStock(array $products, Warehouse $warehouse): void
    {
        // Starting stock quantities (realistic bottle-store levels)
        $quantities = [120, 60, 96, 84, 120, 144, 96, 72, 96, 180, 120, 240, 180, 240, 480, 360, 720, 216, 360, 240, 480, 240, 480, 120, 240, 240, 240, 48];

        foreach ($products as $i => $product) {
            $qty = $quantities[$i] ?? 100;
            Stock::firstOrCreate(
                ['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'product_variant_id' => null],
                ['quantity' => $qty]
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    private function seedCustomers(Branch $branch): array
    {
        $data = [
            ['name' => 'John Smith',       'email' => 'john.smith@email.com',    'phone' => '+27 82 111 2233', 'address' => '12 Oak Street, Sandton',       'loyalty_points' => 450],
            ['name' => 'Priya Naidoo',     'email' => 'priya.naidoo@email.com',  'phone' => '+27 83 222 3344', 'address' => '45 Lotus Lane, Durban',        'loyalty_points' => 320],
            ['name' => 'Mohammed Salie',   'email' => 'm.salie@email.com',       'phone' => '+27 84 333 4455', 'address' => '7 Palm Ave, Cape Town',        'loyalty_points' => 870],
            ['name' => 'Zanele Khumalo',   'email' => 'z.khumalo@email.com',     'phone' => '+27 71 444 5566', 'address' => '99 Sunflower Road, Soweto',    'loyalty_points' => 210],
            ['name' => 'David van Rensburg','email' => 'd.vanrensburg@email.com', 'phone' => '+27 72 555 6677', 'address' => '3 Vineyard Close, Pretoria',   'loyalty_points' => 1200],
            ['name' => 'Thabo Molefe',     'email' => 'thabo.molefe@email.com',  'phone' => '+27 79 666 7788', 'address' => '55 Mahlomola St, Polokwane',   'loyalty_points' => 90],
            ['name' => 'Lisa du Plessis',  'email' => 'lisa.dp@email.com',       'phone' => '+27 82 777 8899', 'address' => '21 Rose Garden, Bloemfontein', 'loyalty_points' => 560],
            ['name' => 'Sipho Nzama',      'email' => 'sipho.nzama@email.com',   'phone' => '+27 83 888 9900', 'address' => '8 Berea Road, East London',    'loyalty_points' => 150],
        ];

        $customers = [];
        foreach ($data as $d) {
            $customers[] = Customer::firstOrCreate(
                ['email' => $d['email']],
                array_merge($d, ['is_active' => true, 'credit_limit' => 0, 'balance' => 0])
            );
        }
        return $customers;
    }

    // ─────────────────────────────────────────────────────────────────────────
    private function seedSales(Branch $branch, Warehouse $warehouse, User $cashier, User $admin, array $products, array $customers): void
    {
        // Skip if sales already exist to avoid duplicate reference violations on re-seed
        if (Sale::count() > 0) return;
        $salesScenarios = [
            // [customer_index_or_null, payment_method, [product_index => qty, ...], days_ago]
            [0, 'cash',         [14 => 2, 22 => 1],         1],
            [1, 'card',         [0 => 1, 18 => 1, 20 => 1], 1],
            [null, 'cash',      [14 => 3, 15 => 6],         1],
            [2, 'mobile_money', [3 => 1, 1 => 1],           1],
            [null, 'cash',      [9 => 2, 22 => 2],          2],
            [3, 'card',         [6 => 1, 19 => 1, 20 => 1], 2],
            [4, 'card',         [0 => 2, 2 => 1],           2],
            [null, 'cash',      [14 => 4, 21 => 2],         3],
            [5, 'mobile_money', [16 => 1, 17 => 4],         3],
            [0, 'card',         [3 => 1, 22 => 1, 23 => 1], 3],
            [null, 'cash',      [15 => 12, 16 => 6],        4],
            [6, 'card',         [1 => 1, 9 => 1],           4],
            [null, 'cash',      [14 => 2, 20 => 1, 22 => 2],5],
            [1, 'mobile_money', [5 => 1, 19 => 1],          5],
            [7, 'cash',         [10 => 2, 11 => 1],         5],
            [null, 'card',      [0 => 1, 2 => 1],           6],
            [2, 'cash',         [14 => 6, 15 => 3],         6],
            [null, 'cash',      [17 => 4, 21 => 1, 22 => 1],7],
            [3, 'card',         [4 => 1, 7 => 1],           7],
            [4, 'mobile_money', [1 => 1, 5 => 1],           8],
            [null, 'cash',      [14 => 4, 16 => 2],         8],
            [5, 'card',         [0 => 1, 9 => 2, 10 => 1],  9],
            [null, 'cash',      [15 => 6, 22 => 2],         9],
            [6, 'cash',         [3 => 2, 19 => 1, 20 => 1], 10],
            [null, 'card',      [14 => 2, 17 => 2],         10],
            [0, 'mobile_money', [2 => 1, 7 => 1],           11],
            [7, 'card',         [11 => 2, 18 => 1],         12],
            [null, 'cash',      [14 => 5, 15 => 4, 22 => 2],12],
            [1, 'card',         [0 => 1, 5 => 1, 21 => 1],  13],
            [null, 'cash',      [16 => 2, 17 => 3],         14],
            [2, 'mobile_money', [3 => 1, 9 => 1],           14],
            [3, 'cash',         [6 => 1, 13 => 2, 22 => 1], 15],
            [null, 'card',      [14 => 4, 20 => 2],         15],
            [4, 'cash',         [1 => 1, 4 => 1],           16],
            [5, 'card',         [10 => 1, 11 => 1, 19 => 1],17],
            [null, 'cash',      [15 => 6, 16 => 4],         18],
            [6, 'mobile_money', [0 => 1, 2 => 1],           19],
            [null, 'cash',      [14 => 3, 22 => 1],         20],
            [7, 'card',         [3 => 1, 5 => 1, 7 => 1],   21],
            [0, 'cash',         [9 => 2, 12 => 1],          22],
            [null, 'card',      [14 => 4, 15 => 2, 17 => 1],23],
            [1, 'mobile_money', [1 => 1, 19 => 1, 21 => 1], 24],
            [null, 'cash',      [16 => 3, 20 => 2],         25],
            [2, 'card',         [4 => 1, 6 => 1],           26],
            [3, 'cash',         [14 => 2, 22 => 3],         27],
            [null, 'card',      [0 => 1, 2 => 1, 9 => 1],   28],
            [4, 'cash',         [15 => 4, 16 => 2],         29],
            [5, 'mobile_money', [3 => 1, 11 => 1, 13 => 1], 30],
        ];

        $refNum = 1000;
        foreach ($salesScenarios as [$custIdx, $method, $items, $daysAgo]) {
            $customer = ($custIdx !== null && isset($customers[$custIdx])) ? $customers[$custIdx] : null;
            $date     = now()->subDays($daysAgo)->setTime(rand(9, 20), rand(0, 59));
            $user     = ($daysAgo % 3 === 0) ? $admin : $cashier;

            $subtotal = 0;
            $taxTotal = 0;
            $lineItems = [];

            foreach ($items as $prodIdx => $qty) {
                if (!isset($products[$prodIdx])) continue;
                $prod     = $products[$prodIdx];
                $unitPrice = (float)$prod->selling_price;
                $taxRate   = $prod->taxRate ? (float)$prod->taxRate->rate / 100 : 0;
                $lineSubtotal = round($unitPrice * $qty, 2);
                $lineTax      = round($lineSubtotal * $taxRate, 2);
                $lineTotal    = $lineSubtotal + $lineTax;

                $subtotal += $lineSubtotal;
                $taxTotal += $lineTax;
                $lineItems[] = [
                    'product'   => $prod,
                    'qty'       => $qty,
                    'unit_price'=> $unitPrice,
                    'cost_price'=> (float)$prod->cost_price,
                    'tax_amount'=> $lineTax,
                    'subtotal'  => $lineSubtotal,
                    'total'     => $lineTotal,
                ];
            }

            if (empty($lineItems)) continue;

            $total = round($subtotal + $taxTotal, 2);
            $ref   = 'SALE-' . str_pad($refNum++, 5, '0', STR_PAD_LEFT);

            $sale = Sale::create([
                'reference'     => $ref,
                'branch_id'     => $branch->id,
                'warehouse_id'  => $warehouse->id,
                'customer_id'   => $customer?->id,
                'user_id'       => $user->id,
                'status'        => 'completed',
                'currency_code' => 'USD',
                'exchange_rate' => 1.0,
                'subtotal'      => $subtotal,
                'discount_amount'=> 0,
                'tax_amount'    => $taxTotal,
                'total'         => $total,
                'amount_paid'   => $total,
                'change_due'    => 0,
                'completed_at'  => $date,
                'created_at'    => $date,
                'updated_at'    => $date,
            ]);

            foreach ($lineItems as $line) {
                SaleItem::create([
                    'sale_id'    => $sale->id,
                    'product_id' => $line['product']->id,
                    'quantity'   => $line['qty'],
                    'unit_price' => $line['unit_price'],
                    'cost_price' => $line['cost_price'],
                    'tax_amount' => $line['tax_amount'],
                    'subtotal'   => $line['subtotal'],
                    'total'      => $line['total'],
                ]);

                // Deduct stock
                $stock = Stock::where('product_id', $line['product']->id)
                    ->where('warehouse_id', $warehouse->id)
                    ->first();
                if ($stock && $stock->quantity >= $line['qty']) {
                    $stock->decrement('quantity', $line['qty']);
                }
            }

            SalePayment::create([
                'sale_id' => $sale->id,
                'method'  => $method,
                'amount'  => $total,
            ]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    private function seedExpenses(Branch $branch, User $admin): void
    {
        $cats = ExpenseCategory::pluck('id', 'name');

        $expenseData = [
            ['cat' => 'Rent',           'desc' => 'Monthly store rental',             'amount' => 2500.00, 'days_ago' => 1],
            ['cat' => 'Utilities',      'desc' => 'Electricity & water bill',         'amount' => 320.00,  'days_ago' => 2],
            ['cat' => 'Salaries',       'desc' => 'Staff wages – week 1',             'amount' => 1800.00, 'days_ago' => 4],
            ['cat' => 'Salaries',       'desc' => 'Staff wages – week 2',             'amount' => 1800.00, 'days_ago' => 11],
            ['cat' => 'Salaries',       'desc' => 'Staff wages – week 3',             'amount' => 1800.00, 'days_ago' => 18],
            ['cat' => 'Salaries',       'desc' => 'Staff wages – week 4',             'amount' => 1800.00, 'days_ago' => 25],
            ['cat' => 'Marketing',      'desc' => 'Facebook ads – May campaign',      'amount' => 150.00,  'days_ago' => 5],
            ['cat' => 'Maintenance',    'desc' => 'Refrigerator compressor repair',   'amount' => 280.00,  'days_ago' => 8],
            ['cat' => 'Transport',      'desc' => 'Supplier delivery charges',        'amount' => 95.00,   'days_ago' => 9],
            ['cat' => 'Office Supplies','desc' => 'POS receipt paper rolls (10x)',    'amount' => 35.00,   'days_ago' => 12],
            ['cat' => 'Utilities',      'desc' => 'Internet & phone bill',            'amount' => 85.00,   'days_ago' => 15],
            ['cat' => 'Marketing',      'desc' => 'Store signage update',             'amount' => 220.00,  'days_ago' => 16],
            ['cat' => 'Transport',      'desc' => 'Fuel for stock collection',        'amount' => 60.00,   'days_ago' => 20],
            ['cat' => 'Maintenance',    'desc' => 'Shelving unit installation',       'amount' => 175.00,  'days_ago' => 22],
            ['cat' => 'Miscellaneous',  'desc' => 'Cleaning supplies & toiletries',  'amount' => 45.00,   'days_ago' => 28],
        ];

        $refNum = 1;
        foreach ($expenseData as $e) {
            $catId = $cats[$e['cat']] ?? null;
            if (!$catId) continue;
            $date = now()->subDays($e['days_ago']);
            Expense::firstOrCreate(
                ['reference' => 'EXP-' . str_pad($refNum, 4, '0', STR_PAD_LEFT)],
                [
                    'reference'           => 'EXP-' . str_pad($refNum, 4, '0', STR_PAD_LEFT),
                    'branch_id'           => $branch->id,
                    'expense_category_id' => $catId,
                    'user_id'             => $admin->id,
                    'description'         => $e['desc'],
                    'amount'              => $e['amount'],
                    'currency_code'       => 'USD',
                    'exchange_rate'       => 1.0,
                    'amount_usd'          => $e['amount'],
                    'expense_date'        => $date->toDateString(),
                    'status'              => 'approved',
                    'created_at'          => $date,
                    'updated_at'          => $date,
                ]
            );
            $refNum++;
        }
    }
}
