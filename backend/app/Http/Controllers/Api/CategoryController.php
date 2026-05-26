<?php namespace App\Http\Controllers\Api;
use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CategoryController extends BaseApiController
{
    public function index(): \Illuminate\Http\JsonResponse { return $this->success(Category::with('parent','children')->orderBy('name')->get()); }
    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['name'=>'required|string','parent_id'=>'nullable|exists:categories,id','description'=>'nullable|string']);
        $data['slug'] = Str::slug($data['name']) . '-' . uniqid();
        return $this->success(Category::create($data), 'Category created', 201);
    }
    public function show(Category $category): \Illuminate\Http\JsonResponse { return $this->success($category->load('children')); }
    public function update(Request $request, Category $category): \Illuminate\Http\JsonResponse
    {
        $category->update($request->only('name','parent_id','description','is_active','sort_order'));
        return $this->success($category, 'Category updated');
    }
    public function destroy(Category $category): \Illuminate\Http\JsonResponse { $category->delete(); return $this->success(null,'Category deleted'); }
}
