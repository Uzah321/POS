<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Commission;
use App\Models\Sale;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CommissionController extends Controller {
    public function index(Request $request) {
        $q = Commission::with(['user','sale'])->latest();
        if ($request->branch_id) $q->whereHas('sale', fn($sq) => $sq->where('branch_id',$request->branch_id));
        if ($request->user_id) $q->where('user_id',$request->user_id);
        if ($request->status) $q->where('status',$request->status);
        if ($request->from) $q->whereDate('created_at','>=',$request->from);
        if ($request->to) $q->whereDate('created_at','<=',$request->to);
        return response()->json($q->paginate(30));
    }
    public function report(Request $request) {
        $from = $request->from ?? now()->startOfMonth()->toDateString();
        $to   = $request->to ?? now()->toDateString();
        $rows = Commission::with('user')
            ->whereBetween(DB::raw('DATE(created_at)'),[$from,$to])
            ->selectRaw('user_id, SUM(amount) as total_commission, COUNT(*) as sales_count, status')
            ->groupBy('user_id','status')
            ->get();
        return response()->json($rows);
    }
    public function markPaid(Request $request) {
        $data = $request->validate(['ids'=>'required|array','ids.*'=>'exists:commissions,id']);
        Commission::whereIn('id',$data['ids'])->update(['status'=>'paid','paid_at'=>now()]);
        return response()->json(['message'=>'Marked as paid']);
    }
}
