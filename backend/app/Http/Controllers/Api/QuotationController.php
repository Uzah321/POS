<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\{Quotation,QuotationItem,Sale,SaleItem,SalePayment,Stock};
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class QuotationController extends Controller {
    public function index(Request $request) {
        $q = Quotation::with(['customer','user'])->latest();
        if ($request->branch_id) $q->where('branch_id',$request->branch_id);
        if ($request->status) $q->where('status',$request->status);
        return response()->json($q->paginate(20));
    }
    public function store(Request $request) {
        $data = $request->validate(['customer_id'=>'nullable|exists:customers,id','branch_id'=>'nullable|exists:branches,id','valid_until'=>'nullable|date','notes'=>'nullable|string','items'=>'required|array|min:1','items.*.product_id'=>'nullable|exists:products,id','items.*.name'=>'required|string','items.*.quantity'=>'required|numeric|min:0.001','items.*.unit_price'=>'required|numeric|min:0','items.*.discount'=>'nullable|numeric|min:0','items.*.tax_amount'=>'nullable|numeric|min:0']);
        $subtotal=0; $tax=0; $discount=0;
        foreach($data['items'] as $item){ $subtotal+=$item['unit_price']*$item['quantity']; $tax+=($item['tax_amount']??0); $discount+=($item['discount']??0); }
        $quotation = Quotation::create(['branch_id'=>$data['branch_id']??$request->user()->branch_id,'customer_id'=>$data['customer_id']??null,'user_id'=>$request->user()->id,'reference'=>'QUO-'.strtoupper(Str::random(8)),'status'=>'draft','subtotal'=>$subtotal,'tax'=>$tax,'discount'=>$discount,'total'=>$subtotal+$tax-$discount,'valid_until'=>$data['valid_until']??null,'notes'=>$data['notes']??null]);
        foreach($data['items'] as $item) { $item['quotation_id']=$quotation->id; $item['subtotal']=($item['unit_price']*$item['quantity'])+($item['tax_amount']??0)-($item['discount']??0); QuotationItem::create($item); }
        return response()->json($quotation->load('items'), 201);
    }
    public function show(Quotation $quotation) { return response()->json($quotation->load(['customer','user','items.product'])); }
    public function update(Request $request, Quotation $quotation) {
        $quotation->update($request->only(['status','valid_until','notes']));
        return response()->json($quotation);
    }
    public function destroy(Quotation $quotation) { $quotation->delete(); return response()->json(null,204); }
}
