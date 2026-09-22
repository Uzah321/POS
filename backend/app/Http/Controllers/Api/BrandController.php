<?php namespace App\Http\Controllers\Api;
use App\Models\Brand;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class BrandController extends BaseApiController
{
    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $branchId = $this->effectiveBranchId($request);
        return $this->success(
            Brand::when($branchId, fn($q) => $q->where('branch_id', $branchId))->orderBy('name')->get()
        );
    }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $request->user();
        $branchId = ($user->hasRole('admin') && $request->filled('branch_id'))
            ? (int) $request->branch_id
            : $user->branch_id;
        $data = $request->validate([
            'name' => ['required', 'string', Rule::unique('brands')->where(fn($q) => $q->where('branch_id', $branchId))],
        ]);
        $data['slug'] = Str::slug($data['name']);
        $data['branch_id'] = $branchId;
        return $this->success(Brand::create($data),'Brand created',201);
    }
    public function show(Brand $brand): \Illuminate\Http\JsonResponse { return $this->success($brand); }
    public function update(Request $request, Brand $brand): \Illuminate\Http\JsonResponse { $brand->update($request->only('name','is_active')); return $this->success($brand,'Brand updated'); }
    public function destroy(Brand $brand): \Illuminate\Http\JsonResponse { $brand->delete(); return $this->success(null,'Brand deleted'); }
}
