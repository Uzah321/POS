<?php
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Product;
use App\Models\Stock;

$p = Product::firstOrCreate(
    ['sku' => 'VEG-CAB-1KG'],
    [
        'name'            => 'Cabbage 1kg',
        'slug'            => 'cabbage-1kg-001',
        'barcode'         => '6009001007005',
        'category_id'     => 18,  // Fruit & Vegetables
        'unit_id'         => 2,   // kg
        'tax_rate_id'     => 2,   // Zero rated
        'cost_price'      => 0.40,
        'selling_price'   => 0.79,
        'wholesale_price' => 0.65,
        'reorder_level'   => 20,
        'is_active'       => true,
        'track_stock'     => true,
    ]
);

Stock::firstOrCreate(
    ['product_id' => $p->id, 'warehouse_id' => 1],
    ['quantity' => 150, 'reserved_quantity' => 0]
);

echo "Product: {$p->name} (id={$p->id})\n";
echo "Stock: " . Stock::where('product_id', $p->id)->sum('quantity') . " units\n";
echo "Done!\n";
