<?php namespace App\Http\Controllers\Api;
use App\Models\Brand;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class BrandController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse { return $this->success(Brand::orderBy('name')->get()); }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['name'=>'required|string|unique:brands']);
        $data['slug'] = Str::slug($data['name']);
        return $this->success(Brand::create($data),'Brand created',201);
    }
    public function show(Brand $brand): \Illuminate\Http\JsonResponse { return $this->success($brand); }
    public function update(Request $request, Brand $brand): \Illuminate\Http\JsonResponse { $brand->update($request->only('name','is_active')); return $this->success($brand,'Brand updated'); }
    public function destroy(Brand $brand): \Illuminate\Http\JsonResponse { $brand->delete(); return $this->success(null,'Brand deleted'); }
}
