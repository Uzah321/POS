<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Webhook;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class WebhookController extends Controller {
    public function index() { return response()->json(Webhook::all()); }
    public function store(Request $request) {
        $data = $request->validate(['name'=>'required|string','url'=>'required|url','events'=>'required|array','events.*'=>'string','secret'=>'nullable|string','active'=>'boolean']);
        return response()->json(Webhook::create($data), 201);
    }
    public function show(Webhook $webhook) { return response()->json($webhook); }
    public function update(Request $request, Webhook $webhook) {
        $webhook->update($request->only(['name','url','events','secret','active']));
        return response()->json($webhook);
    }
    public function destroy(Webhook $webhook) { $webhook->delete(); return response()->json(null,204); }
    public function test(Webhook $webhook) {
        try {
            $response = Http::timeout(5)->withHeaders($webhook->secret ? ['X-Webhook-Secret'=>$webhook->secret] : [])
                ->post($webhook->url, ['event'=>'test','data'=>['message'=>'POS webhook test']]);
            $webhook->update(['last_triggered_at'=>now()]);
            return response()->json(['status'=>$response->status(),'success'=>$response->successful()]);
        } catch(\Exception $e) { return response()->json(['success'=>false,'error'=>$e->getMessage()],422); }
    }
}
