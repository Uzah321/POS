<?php
namespace App\Http\Controllers\Api;
use App\Models\Stocktake;
use App\Models\StocktakeItem;
use App\Models\Stock;
use App\Models\Warehouse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class StocktakeController extends BaseApiController {
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
        foreach($stocks as $stock) StocktakeItem::create(['stocktake_id'=>$stocktake->id,'product_id'=>$stock->product_id,'expected_qty'=>$stock->quantity]);
        return $this->success($stocktake->load('items.product'), 'Stocktake created', 201);
    }
    public function show(Stocktake $stocktake) { return $this->success($stocktake->load(['branch','user','items.product'])); }
    public function update(Request $request, Stocktake $stocktake) {
        $data = $request->validate(['items'=>'required|array','items.*.id'=>'required|exists:stocktake_items,id','items.*.counted_qty'=>'required|numeric|min:0']);
        foreach($data['items'] as $item) {
            $si = StocktakeItem::find($item['id']);
            $si->update(['counted_qty'=>$item['counted_qty'],'variance'=>$item['counted_qty']-$si->expected_qty]);
        }
        $stocktake->update(['status'=>'in_progress']);
        return $this->success($stocktake->load('items.product'), 'Counts saved');
    }
    public function complete(Request $request, Stocktake $stocktake) {
        if ($stocktake->status==='completed') return $this->error('Already completed', 422);
        foreach($stocktake->items as $item) {
            if (!is_null($item->counted_qty)) {
                $wIds = Warehouse::where('branch_id', $stocktake->branch_id)->pluck('id');
                Stock::where('product_id', $item->product_id)->whereIn('warehouse_id', $wIds)->update(['quantity' => $item->counted_qty]);
            }
        }
        $stocktake->update(['status'=>'completed']);
        return $this->success($stocktake->fresh(), 'Stocktake completed — stock levels updated');
    }
}
