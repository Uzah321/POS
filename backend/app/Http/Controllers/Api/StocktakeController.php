<?php
namespace App\Http\Controllers\Api;
use App\Models\Stocktake;
use App\Models\StocktakeItem;
use App\Models\Stock;
use App\Models\IngredientStock;
use App\Models\Warehouse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class StocktakeController extends BaseApiController {
    // A stocktake line is always exactly one of a product's stock row or an
    // ingredient's — load both relations so the caller can render whichever is set.
    private function loadItems(Stocktake $stocktake): Stocktake {
        return $stocktake->load([
            'items.product' => fn($q) => $q->withTrashed()->with('unit'),
            'items.ingredient.unit',
        ]);
    }

    public function index(Request $request) {
        $q = Stocktake::with(['branch','user'])->latest();
        if ($request->status) $q->where('status',$request->status);
        return response()->json($q->paginate(20));
    }
    public function store(Request $request) {
        $data = $request->validate(['branch_id'=>'nullable|exists:branches,id','notes'=>'nullable|string']);
        $branchId = $data['branch_id'] ?? $request->user()->branch_id;
        $stocktake = Stocktake::create(['branch_id'=>$branchId,'user_id'=>$request->user()->id,'reference'=>'STK-'.strtoupper(Str::random(8)),'status'=>'draft','notes'=>$data['notes']??null]);
        $warehouseIds = Warehouse::where('branch_id', $branchId)->pluck('id');

        $stocks = Stock::whereIn('warehouse_id', $warehouseIds)->get();
        foreach($stocks as $stock) StocktakeItem::create([
            'stocktake_id'       => $stocktake->id,
            'product_id'         => $stock->product_id,
            'product_variant_id' => $stock->product_variant_id,
            'stock_id'           => $stock->id,
            'expected_qty'       => $stock->quantity,
        ]);

        // Ingredients get counted in the same physical walk-through as products,
        // so they belong in the same stocktake rather than a separate flow.
        $ingredientStocks = IngredientStock::whereIn('warehouse_id', $warehouseIds)->get();
        foreach($ingredientStocks as $stock) StocktakeItem::create([
            'stocktake_id'        => $stocktake->id,
            'ingredient_id'       => $stock->ingredient_id,
            'ingredient_stock_id' => $stock->id,
            'expected_qty'        => $stock->quantity,
        ]);

        return $this->success($this->loadItems($stocktake), 'Stocktake created', 201);
    }
    public function show(Stocktake $stocktake) {
        return $this->success($this->loadItems($stocktake)->load('branch', 'user'));
    }
    public function update(Request $request, Stocktake $stocktake) {
        $data = $request->validate(['items'=>'required|array','items.*.id'=>'required|exists:stocktake_items,id','items.*.counted_qty'=>'required|numeric|min:0']);
        foreach($data['items'] as $item) {
            $si = StocktakeItem::find($item['id']);
            $si->update(['counted_qty'=>$item['counted_qty'],'variance'=>$item['counted_qty']-$si->expected_qty]);
        }
        $stocktake->update(['status'=>'in_progress']);
        return $this->success($this->loadItems($stocktake), 'Counts saved');
    }
    public function complete(Request $request, Stocktake $stocktake) {
        if ($stocktake->status==='completed') return $this->error('Already completed', 422);
        foreach($stocktake->items as $item) {
            if (is_null($item->counted_qty)) continue;

            if ($item->ingredient_stock_id) {
                IngredientStock::where('id', $item->ingredient_stock_id)->update(['quantity' => $item->counted_qty]);
            } elseif ($item->ingredient_id) {
                // Legacy ingredient line without a stock_id — shouldn't occur for
                // items created after this feature shipped, but mirrors the
                // product fallback below just in case.
                $wIds = Warehouse::where('branch_id', $stocktake->branch_id)->pluck('id');
                IngredientStock::where('ingredient_id', $item->ingredient_id)->whereIn('warehouse_id', $wIds)->update(['quantity' => $item->counted_qty]);
            } elseif ($item->stock_id) {
                // Update exactly the stock row this line was counted from — a product
                // with more than one warehouse/batch row gets one line per row, and
                // each must only touch its own row, not every row sharing product_id.
                Stock::where('id', $item->stock_id)->update(['quantity' => $item->counted_qty]);
            } else {
                // Legacy stocktake items created before stock_id existed.
                $wIds = Warehouse::where('branch_id', $stocktake->branch_id)->pluck('id');
                Stock::where('product_id', $item->product_id)->whereIn('warehouse_id', $wIds)->update(['quantity' => $item->counted_qty]);
            }
        }
        $stocktake->update(['status'=>'completed']);
        return $this->success($stocktake->fresh(), 'Stocktake completed — stock levels updated');
    }
}
