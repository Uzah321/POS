<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\ProductBatch;
use Illuminate\Http\Request;

class ProductBatchController extends Controller {
    public function index(Request $request) {
        $q = ProductBatch::with('product')->latest();
        if ($request->product_id) $q->where('product_id',$request->product_id);
        if ($request->expiring_soon) $q->whereNotNull('expiry_date')->where('expiry_date','<=',now()->addDays(30));
        return response()->json($q->paginate(30));
    }
    public function store(Request $request) {
        $data = $request->validate(['product_id'=>'required|exists:products,id','product_variant_id'=>'nullable|exists:product_variants,id','batch_number'=>'required|string','expiry_date'=>'nullable|date','quantity'=>'required|numeric|min:0','cost_price'=>'nullable|numeric|min:0']);
        return response()->json(ProductBatch::create($data), 201);
    }
    public function show(ProductBatch $productBatch) { return response()->json($productBatch->load('product')); }
    public function update(Request $request, ProductBatch $productBatch) {
        $productBatch->update($request->only(['quantity','expiry_date','cost_price']));
        return response()->json($productBatch);
    }
    public function destroy(ProductBatch $productBatch) { $productBatch->delete(); return response()->json(null,204); }
}
