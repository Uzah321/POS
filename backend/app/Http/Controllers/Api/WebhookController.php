<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Webhook;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class WebhookController extends Controller
{
    private function offlineMode(): bool
    {
        return filter_var(env('OFFLINE_MODE', true), FILTER_VALIDATE_BOOLEAN);
    }

    private function isLocalNetworkUrl(string $url): bool
    {
        $parts = parse_url($url);
        $host = strtolower(trim($parts['host'] ?? '', '[]'));

        if ($host === '' || $host === 'localhost' || $host === '::1') return true;
        if (str_starts_with($host, '127.')) return true;
        if (str_starts_with($host, '10.')) return true;
        if (str_starts_with($host, '192.168.')) return true;
        if (str_ends_with($host, '.local') || !str_contains($host, '.')) return true;

        $octets = array_map('intval', explode('.', $host));
        return count($octets) === 4 && $octets[0] === 172 && $octets[1] >= 16 && $octets[1] <= 31;
    }

    private function validateOfflineUrl(string $url): void
    {
        if ($this->offlineMode() && !$this->isLocalNetworkUrl($url)) {
            throw ValidationException::withMessages([
                'url' => 'Offline mode only allows localhost or private LAN webhook URLs.',
            ]);
        }
    }

    public function index() { return response()->json(Webhook::all()); }

    public function store(Request $request) {
        $data = $request->validate(['name'=>'required|string','url'=>'required|url','events'=>'required|array','events.*'=>'string','secret'=>'nullable|string','active'=>'boolean']);
        $this->validateOfflineUrl($data['url']);
        return response()->json(Webhook::create($data), 201);
    }

    public function show(Webhook $webhook) { return response()->json($webhook); }

    public function update(Request $request, Webhook $webhook) {
        $data = $request->validate(['name'=>'sometimes|string','url'=>'sometimes|url','events'=>'sometimes|array','events.*'=>'string','secret'=>'nullable|string','active'=>'boolean']);
        if (isset($data['url'])) $this->validateOfflineUrl($data['url']);
        $webhook->update($data);
        return response()->json($webhook);
    }

    public function destroy(Webhook $webhook) { $webhook->delete(); return response()->json(null,204); }

    public function test(Webhook $webhook) {
        try {
            $this->validateOfflineUrl($webhook->url);
            $response = Http::timeout(5)->withHeaders($webhook->secret ? ['X-Webhook-Secret'=>$webhook->secret] : [])
                ->post($webhook->url, ['event'=>'test','data'=>['message'=>'POS webhook test']]);
            $webhook->update(['last_triggered_at'=>now()]);
            return response()->json(['status'=>$response->status(),'success'=>$response->successful()]);
        } catch(\Exception $e) { return response()->json(['success'=>false,'message'=>$e->getMessage(),'error'=>$e->getMessage()],422); }
    }
}
