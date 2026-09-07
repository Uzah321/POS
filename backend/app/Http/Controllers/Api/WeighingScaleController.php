<?php namespace App\Http\Controllers\Api;
use App\Models\WeighingScale;
use Illuminate\Http\Request;

class WeighingScaleController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse
    {
        return $this->success(WeighingScale::withCount('products')->orderBy('name')->get());
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $this->validated($request);
        return $this->success(WeighingScale::create($data), 'Scale created', 201);
    }

    public function show(WeighingScale $weighingScale): \Illuminate\Http\JsonResponse
    {
        return $this->success($weighingScale->loadCount('products'));
    }

    public function update(Request $request, WeighingScale $weighingScale): \Illuminate\Http\JsonResponse
    {
        $data = $this->validated($request, sometimes: true);
        $weighingScale->update($data);
        return $this->success($weighingScale, 'Scale updated');
    }

    public function destroy(WeighingScale $weighingScale): \Illuminate\Http\JsonResponse
    {
        $weighingScale->delete();
        return $this->success(null, 'Scale deleted');
    }

    private function validated(Request $request, bool $sometimes = false): array
    {
        $req = fn (string $rule) => $sometimes ? "sometimes|$rule" : $rule;
        return $request->validate([
            'name'      => [$req('required'), 'string', 'max:100'],
            'mode'      => [$req('required'), 'in:network,webserial'],
            'host'      => 'nullable|required_if:mode,network|string|max:255',
            'port'      => 'nullable|required_if:mode,network|integer|min:1|max:65535',
            'baud_rate' => 'nullable|integer|min:1200|max:921600',
            'is_active' => 'boolean',
        ]);
    }
}
