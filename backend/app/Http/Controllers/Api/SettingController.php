<?php namespace App\Http\Controllers\Api;
use App\Models\Setting;
use Illuminate\Http\Request;

class SettingController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse { return $this->success(Setting::all()->keyBy('key')->map(fn($s) => $s->value)); }
    public function update(Request $request): \Illuminate\Http\JsonResponse
    {
        foreach ($request->all() as $key => $value) {
            Setting::set($key, $value);
        }
        return $this->success(null,'Settings saved');
    }
}
