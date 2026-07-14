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

        // All prices in USD — trimmed to 2 products per category (20 total) to
        // keep the POS grid easy to test with
        $productsData = [
            // ── Spirits ──────────────────────────────────────────────────────
            ['name' => "Jack Daniel's Old No.7 750ml",  'sku' => 'JD-750',    'barcode' => '5000140204014', 'category' => 'Spirits',              'brand' => 'Jack Daniels',    'cost' => 14.50, 'price' => 22.99,  'wholesale' => 20.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],
            ['name' => 'Amarula Cream 750ml',           'sku' => 'AMR-750',   'barcode' => '6001253001026', 'category' => 'Spirits',              'brand' => 'Amarula',         'cost' => 7.50,  'price' => 13.99,  'wholesale' => 12.00, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 12],

            // ── Wine ─────────────────────────────────────────────────────────
            ['name' => 'Boschendal Shiraz 750ml',               'sku' => 'BSH-SHZ-750', 'barcode' => '6001148002014', 'category' => 'Wine', 'brand' => 'Smirnoff', 'cost' => 5.00, 'price' => 9.99,  'wholesale' => 8.50, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 24],
            ['name' => 'Nederburg Stein 750ml',                 'sku' => 'NDB-STN-750', 'barcode' => '6001148004018', 'category' => 'Wine', 'brand' => 'Smirnoff', 'cost' => 3.00, 'price' => 5.99,  'wholesale' => 4.75, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 36],

            // ── Beer & Cider ──────────────────────────────────────────────────
            ['name' => 'Heineken 500ml Can',         'sku' => 'HNK-500C', 'barcode' => '8712000034503', 'category' => 'Beer & Cider', 'brand' => 'Heineken',       'cost' => 1.00, 'price' => 1.99,  'wholesale' => 1.65, 'unit' => $canUnit, 'tax' => $vatRate, 'reorder' => 120],
            ['name' => 'Castle Lager 330ml Can',     'sku' => 'CSL-330C', 'barcode' => '6001007000020', 'category' => 'Beer & Cider', 'brand' => 'Castle Lager',   'cost' => 0.75, 'price' => 1.49,  'wholesale' => 1.25, 'unit' => $canUnit, 'tax' => $vatRate, 'reorder' => 240],

            // ── Mixers & Soft Drinks ──────────────────────────────────────────
            ['name' => 'Coca-Cola 2L',                'sku' => 'CCA-2L',      'barcode' => '5449000000996', 'category' => 'Mixers & Soft Drinks', 'brand' => 'Heineken', 'cost' => 0.60, 'price' => 1.29,  'wholesale' => 1.05, 'unit' => $btlUnit, 'tax' => $vatRate, 'reorder' => 48],
            ['name' => 'Red Bull Energy 250ml',       'sku' => 'RBL-250',     'barcode' => '9002490100070', 'category' => 'Mixers & Soft Drinks', 'brand' => 'Heineken', 'cost' => 0.90, 'price' => 1.89,  'wholesale' => 1.55, 'unit' => $canUnit, 'tax' => $vatRate, 'reorder' => 48],

            // ── Fresh Meat (Butcher) ──────────────────────────────────────────
            ['name' => 'Beef Mince 500g',           'sku' => 'BF-MNC-500',  'barcode' => '6009001001001', 'category' => 'Fresh Meat',         'brand' => 'Pick n Pay',   'cost' => 2.50,  'price' => 4.99,  'wholesale' => 4.25, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],
            ['name' => 'Boerewors 500g',            'sku' => 'BW-500',      'barcode' => '6009001001005', 'category' => 'Fresh Meat',         'brand' => 'Pick n Pay',   'cost' => 3.00,  'price' => 5.49,  'wholesale' => 4.75, 'unit' => $kgUnit, 'tax' => $vatRate,  'reorder' => 20],

            // ── Dairy & Eggs ──────────────────────────────────────────────────
            ['name' => 'Full Cream Milk 2L',        'sku' => 'MLK-FC-2L',   'barcode' => '6009001005001', 'category' => 'Dairy & Eggs',       'brand' => 'Clover',       'cost' => 1.20,  'price' => 2.19,  'wholesale' => 1.89, 'unit' => $lUnit,  'tax' => $zeroRate, 'reorder' => 50],
            ['name' => 'Cheddar Cheese 400g',       'sku' => 'CHS-CHD-400', 'barcode' => '6009001005002', 'category' => 'Dairy & Eggs',       'brand' => 'Clover',       'cost' => 2.50,  'price' => 4.49,  'wholesale' => 3.75, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 20],

            // ── Bread & Bakery ────────────────────────────────────────────────
            ['name' => 'White Bread 700g',          'sku' => 'BRD-WHT-700', 'barcode' => '6009001006001', 'category' => 'Bread & Bakery',     'brand' => 'Sasko',        'cost' => 0.70,  'price' => 1.29,  'wholesale' => 1.05, 'unit' => $pcUnit, 'tax' => $zeroRate, 'reorder' => 40],
            ['name' => 'Brown Bread 700g',          'sku' => 'BRD-BRN-700', 'barcode' => '6009001006002', 'category' => 'Bread & Bakery',     'brand' => 'Sasko',        'cost' => 0.75,  'price' => 1.39,  'wholesale' => 1.15, 'unit' => $pcUnit, 'tax' => $zeroRate, 'reorder' => 40],

            // ── Fruit & Vegetables ────────────────────────────────────────────
            ['name' => 'Tomatoes 1kg',              'sku' => 'VEG-TOM-1KG', 'barcode' => '6009001007001', 'category' => 'Fruit & Vegetables', 'brand' => 'Pick n Pay',   'cost' => 0.60,  'price' => 1.19,  'wholesale' => 0.99, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 30],
            ['name' => 'Apples 1.5kg',              'sku' => 'FRT-APL-15',  'barcode' => '6009001007003', 'category' => 'Fruit & Vegetables', 'brand' => 'Woolworths',   'cost' => 1.00,  'price' => 1.99,  'wholesale' => 1.69, 'unit' => $kgUnit, 'tax' => $zeroRate, 'reorder' => 20],

            // ── Cleaning & Household ──────────────────────────────────────────
            ['name' => 'Liquid Dish Soap 750ml',    'sku' => 'CLN-DSP-750', 'barcode' => '6009001011002', 'category' => 'Cleaning & Household','brand' => 'Sunlight',    'cost' => 1.00,  'price' => 1.79,  'wholesale' => 1.49, 'unit' => $btlUnit,'tax' => $vatRate,  'reorder' => 24],
            ['name' => 'Bleach 750ml',              'sku' => 'CLN-BLC-750', 'barcode' => '6009001011003', 'category' => 'Cleaning & Household','brand' => 'Shoprite',    'cost' => 0.70,  'price' => 1.29,  'wholesale' => 1.05, 'unit' => $btlUnit,'tax' => $vatRate,  'reorder' => 20],

            // ── Confectionery ─────────────────────────────────────────────────
            ['name' => 'Milk Chocolate 200g',       'sku' => 'CNF-CHC-200', 'barcode' => '6009001013001', 'category' => 'Confectionery',      'brand' => 'Cadbury',      'cost' => 1.20,  'price' => 2.19,  'wholesale' => 1.89, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 30],
            ['name' => 'Wine Gums 250g',            'sku' => 'CNF-WGM-250', 'barcode' => '6009001013002', 'category' => 'Confectionery',      'brand' => 'Pick n Pay',   'cost' => 0.80,  'price' => 1.49,  'wholesale' => 1.25, 'unit' => $pkUnit, 'tax' => $vatRate,  'reorder' => 30],
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
        // Starting stock quantities (realistic bottle-store levels), one per product
        $quantities = [120, 96, 84, 96, 240, 480, 240, 240, 96, 120, 180, 96, 360, 240, 240, 180, 144, 168, 240, 240];

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
            [0, 'cash',         [14 => 2, 6 => 1],          1],
            [1, 'card',         [0 => 1, 18 => 1, 4 => 1],  1],
            [null, 'cash',      [14 => 3, 15 => 6],         1],
            [2, 'mobile_money', [3 => 1, 1 => 1],           1],
            [null, 'cash',      [9 => 2, 6 => 2],           2],
            [3, 'card',         [6 => 1, 19 => 1, 4 => 1],  2],
            [4, 'card',         [0 => 2, 2 => 1],           2],
            [null, 'cash',      [14 => 4, 5 => 2],          3],
            [5, 'mobile_money', [16 => 1, 17 => 4],         3],
            [0, 'card',         [3 => 1, 6 => 1, 7 => 1],   3],
            [null, 'cash',      [15 => 12, 16 => 6],        4],
            [6, 'card',         [1 => 1, 9 => 1],           4],
            [null, 'cash',      [14 => 2, 4 => 1, 6 => 2],  5],
            [1, 'mobile_money', [5 => 1, 19 => 1],          5],
            [7, 'cash',         [10 => 2, 11 => 1],         5],
            [null, 'card',      [0 => 1, 2 => 1],           6],
            [2, 'cash',         [14 => 6, 15 => 3],         6],
            [null, 'cash',      [17 => 4, 5 => 1, 6 => 1],  7],
            [3, 'card',         [4 => 1, 7 => 1],           7],
            [4, 'mobile_money', [1 => 1, 5 => 1],           8],
            [null, 'cash',      [14 => 4, 16 => 2],         8],
            [5, 'card',         [0 => 1, 9 => 2, 10 => 1],  9],
            [null, 'cash',      [15 => 6, 6 => 2],          9],
            [6, 'cash',         [3 => 2, 19 => 1, 4 => 1],  10],
            [null, 'card',      [14 => 2, 17 => 2],         10],
            [0, 'mobile_money', [2 => 1, 7 => 1],           11],
            [7, 'card',         [11 => 2, 18 => 1],         12],
            [null, 'cash',      [14 => 5, 15 => 4, 6 => 2], 12],
            [1, 'card',         [0 => 1, 5 => 1, 8 => 1],   13],
            [null, 'cash',      [16 => 2, 17 => 3],         14],
            [2, 'mobile_money', [3 => 1, 9 => 1],           14],
            [3, 'cash',         [6 => 1, 13 => 2, 12 => 1], 15],
            [null, 'card',      [14 => 4, 4 => 2],          15],
            [4, 'cash',         [1 => 1, 4 => 1],           16],
            [5, 'card',         [10 => 1, 11 => 1, 19 => 1],17],
            [null, 'cash',      [15 => 6, 16 => 4],         18],
            [6, 'mobile_money', [0 => 1, 2 => 1],           19],
            [null, 'cash',      [14 => 3, 6 => 1],          20],
            [7, 'card',         [3 => 1, 5 => 1, 7 => 1],   21],
            [0, 'cash',         [9 => 2, 12 => 1],          22],
            [null, 'card',      [14 => 4, 15 => 2, 17 => 1],23],
            [1, 'mobile_money', [1 => 1, 19 => 1, 4 => 1],  24],
            [null, 'cash',      [16 => 3, 4 => 2],          25],
            [2, 'card',         [4 => 1, 6 => 1],           26],
            [3, 'cash',         [14 => 2, 6 => 3],          27],
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
