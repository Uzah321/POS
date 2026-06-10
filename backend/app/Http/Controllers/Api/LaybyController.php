<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Layby;
use App\Models\LaybyPayment;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class LaybyController extends Controller {
    public function index(Request $request) {
        $q = Layby::with(['customer','user'])->latest();
        if ($request->branch_id) $q->where('branch_id',$request->branch_id);
        if ($request->status) $q->where('status',$request->status);
        if ($request->customer_id) $q->where('customer_id',$request->customer_id);
        return response()->json($q->paginate(20));
    }
    public function store(Request $request) {
        $data = $request->validate(['customer_id'=>'nullable|exists:customers,id','branch_id'=>'nullable|exists:branches,id','total'=>'required|numeric|min:0','deposit_paid'=>'required|numeric|min:0','due_date'=>'nullable|date','notes'=>'nullable|string','items'=>'required|array|min:1']);
        $data['user_id'] = $request->user()->id;
        $data['branch_id'] = $data['branch_id'] ?? $request->user()->branch_id;
        $data['reference'] = 'LBY-'.strtoupper(Str::random(8));
        $data['balance'] = $data['total'] - $data['deposit_paid'];
        $data['status'] = $data['balance'] <= 0 ? 'complete' : ($data['deposit_paid'] > 0 ? 'partial' : 'pending');
        $layby = Layby::create($data);
        if ($data['deposit_paid'] > 0) LaybyPayment::create(['layby_id'=>$layby->id,'user_id'=>$request->user()->id,'amount'=>$data['deposit_paid'],'method'=>$request->method_type??'cash','notes'=>'Initial deposit']);
        return response()->json($layby->load('payments'), 201);
    }
    public function show(Layby $layby) { return response()->json($layby->load(['customer','user','payments.user'])); }
    public function addPayment(Request $request, Layby $layby) {
        if (in_array($layby->status,['complete','cancelled'])) return response()->json(['message'=>'Layby is '.$layby->status],422);
        $data = $request->validate(['amount'=>'required|numeric|min:0.01','method'=>'nullable|string','notes'=>'nullable|string']);
        $data['layby_id']=$layby->id; $data['user_id']=$request->user()->id;
        LaybyPayment::create($data);
        $nb = $layby->balance - $data['amount'];
        $layby->update(['deposit_paid'=>$layby->deposit_paid+$data['amount'],'balance'=>max(0,$nb),'status'=>$nb<=0?'complete':'partial']);
        return response()->json($layby->fresh(['payments']));
    }
    public function cancel(Layby $layby) {
        if ($layby->status==='complete') return response()->json(['message'=>'Cannot cancel a completed layby'],422);
        $layby->update(['status'=>'cancelled']);
        return response()->json($layby);
    }
}
